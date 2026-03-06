import asyncio
import json
import logging
import time
import os
import websockets
import pandas as pd
import numpy as np
from datetime import datetime, timezone
from aiohttp import ClientSession

logger = logging.getLogger(__name__)

# Configurable Constants
WATCH_SYMBOLS = ["BTCUSDT", "ETHUSDT"]
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws/"
BINANCE_API = "https://fapi.binance.com"
ALL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]

class MarketEngine:
    def __init__(self, bot_url="http://localhost:8888"):
        self.bot_url = bot_url
        self.config = {}
        self.monitored_symbols = []
        self.state = {}
        self.ws_task = None
        self.config_sync_task = None
        
    async def get_bot_config(self):
        """Polls the bot for updated configuration."""
        async with ClientSession() as session:
            try:
                async with session.get(f"{self.bot_url}/config") as resp:
                    if resp.status == 200:
                        self.config = await resp.json()
                        # logger.info("Engine synced with latest bot configuration.")
            except Exception as e:
                logger.error(f"Failed to fetch config from bot: {e}")

    def get_active_session(self):
        """Determines the current market session based on UTC hour."""
        hour = datetime.now(timezone.utc).hour
        if 0 <= hour < 8: return "Asia"
        if 8 <= hour < 16: return "London"
        return "US"

    def is_session_active(self):
        """Checks if the current session is allowed per user configuration."""
        current = self.get_active_session()
        allowed = self.config.get("activeSessions", ["London", "US", "Asia"])
        return current in allowed

    async def send_alert(self, title, message, category, symbol, severity="info", cooldown=60, tf=None):
        """Proxies alerts to the bot API if sessions and global toggles allow."""
        if not self.config.get("globalEnabled", True): return
        if not self.is_session_active(): return
        
        # Check category toggle
        if not self.config.get("categories", {}).get(category, True): return

        # Check timeframe toggle if applicable
        if tf:
            enabled_tfs = self.config.get("timeframes", {}).get(category, ALL_TIMEFRAMES)
            if tf not in enabled_tfs:
                return

        session_name = self.get_active_session()
        payload = {
            "message": f"<b>🚨 {title}</b>\n\n{message}\n\n<i>Session: {session_name}</i>",
            "type": category,
            "severity": severity,
            "symbol": symbol,
            "cooldown": cooldown
        }
        
        async with ClientSession() as session:
            try:
                async with session.post(f"{self.bot_url}/alert", json=payload) as resp:
                    if resp.status != 202:
                        logger.warning(f"Bot rejected alert: {await resp.text()}")
            except Exception as e:
                logger.error(f"Failed to send alert to bot: {e}")

    def calculate_indicators(self, symbol, tf):
        """Calculates indicators including ATR Ratio and RVOL."""
        df = pd.DataFrame(self.state[symbol]["klines"][tf], columns=['t', 'o', 'h', 'l', 'c', 'v'])
        df['c'] = df['c'].astype(float)
        df['h'] = df['h'].astype(float)
        df['l'] = df['l'].astype(float)
        df['v'] = df['v'].astype(float)
        
        # EMA for Regime
        ema21 = df['c'].ewm(span=21, adjust=False).mean().iloc[-1]
        ema50 = df['c'].ewm(span=50, adjust=False).mean().iloc[-1]
        
        # RSI
        delta = df['c'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rsi = 100 - (100 / (1 + (gain/loss))).iloc[-1]
        
        # ATR Ratio (Current TR / SMA 20 of TR)
        df['tr'] = np.maximum(df['h'] - df['l'], np.maximum(abs(df['h'] - df['c'].shift(1)), abs(df['l'] - df['c'].shift(1))))
        atr_ratio = df['tr'].iloc[-1] / df['tr'].rolling(20).mean().iloc[-1]
        
        # RVOL (Current Volume / SMA 20 of Volume)
        rvol = df['v'].iloc[-1] / df['v'].rolling(20).mean().iloc[-1]

        # VWAP (Approximation via candle typical price)
        df['tp'] = (df['h'] + df['l'] + df['c']) / 3
        vwap = (df['tp'] * df['v']).sum() / df['v'].sum()

        # POC (Price at which most volume occurred - 50 bins)
        bins = 50
        counts, bin_edges = np.histogram(df['c'], bins=bins, weights=df['v'])
        poc = bin_edges[np.argmax(counts)]
        
        return ema21, ema50, rsi, atr_ratio, rvol, vwap, poc

    async def monitor_ws(self):
        """Subscribes to all necessary Binance streams for monitored symbols."""
        while True:
            current_symbols = self.config.get("monitoredSymbols", ["BTCUSDT", "ETHUSDT"])
            self.monitored_symbols = current_symbols
            
            # Initialize state for new symbols if missing
            for s in current_symbols:
                if s not in self.state:
                    self.state[s] = {
                        "regime": {}, "volatility": {}, "flow": {},
                        "execution": "Unknown", "levels": {}, "last_price": 0,
                        "klines": {tf: [] for tf in ALL_TIMEFRAMES},
                        "rsi": {tf: 50 for tf in ALL_TIMEFRAMES},
                        "oi_history": [], "spread_history": [],
                        "whale_delta": 0, "funding_rate": 0,
                        "volume_profile": {}, "last_vah": 0, "last_val": 0,
                        "summary_hash": {}, "last_daily_wrap": 0, "last_periodic_summary": 0
                    }

            streams = []
            for s in current_symbols:
                sym = s.lower()
                streams.extend([
                    f"{sym}@aggTrade",
                    f"{sym}@forceOrder",
                    f"{sym}@openInterest@500ms",
                    f"{sym}@markPrice"
                ])
                # Add all 12 kline intervals
                for tf in ALL_TIMEFRAMES:
                    streams.append(f"{sym}@kline_{tf}")
            
            ws_url = f"{BINANCE_FUTURES_WS}{'/'.join(streams)}"
        
            try:
                async with websockets.connect(ws_url) as ws:
                    logger.info(f"Connected to Binance MTF Stream: {len(streams)} feeds")
                    while True:
                        # Check for instant reload signal from bot.py
                        if os.path.exists("reload.flag"):
                            try:
                                os.remove("reload.flag")
                            except OSError:
                                pass
                            await self.get_bot_config()
                            logger.info("Instant reload triggered by flag file.")

                        # Check if monitored symbols changed
                        if self.config.get("monitoredSymbols") != self.monitored_symbols:
                            logger.info("Monitored symbols changed. Rebuilding WebSocket connection...")
                            break # Exit inner loop to reconnect with new streams
                            
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            await self.handle_message(json.loads(msg))
                        except asyncio.TimeoutError:
                            continue # Keep checking for config changes
            except Exception as e:
                logger.error(f"WS Connection lost: {e}. Retrying in 5s...")
                await asyncio.sleep(5)

    async def handle_message(self, data):
        """Main dispatcher for incoming market data."""
        stream = data.get("e")
        symbol = data.get("s")
        if not symbol: return

        # 1. Whale Trades
        if stream == "aggTrade":
            price = float(data['p'])
            amount = price * float(data['q'])
            self.state[symbol]["last_price"] = price # Global price update
            
            # Hierarchical threshold resolution
            thresholds = self.config.get("thresholds", {}).get(symbol, 
                         self.config.get("thresholds", {}).get("global", {}))
            threshold = float(thresholds.get("whaleMinAmount", 500000))
            
            if amount >= threshold:
                side = "🔴 SELL" if data['m'] else "🟢 BUY"
                
                # Update Whale Delta
                delta_change = -amount if data['m'] else amount
                old_delta = self.state[symbol]["whale_delta"]
                self.state[symbol]["whale_delta"] += delta_change
                
                # Check for Momentum Shift ($5M swing)
                momentum_threshold = float(thresholds.get("whaleMomentumDelta", 5000000))
                if abs(self.state[symbol]["whale_delta"] - (old_delta // momentum_threshold * momentum_threshold)) >= momentum_threshold:
                     await self.send_alert(
                        f"[{symbol}] 🐋💨 Whale Momentum Shift",
                        f"<b>Net Flow:</b> ${self.state[symbol]['whale_delta']/1e6:+.2f}M\n<b>Dynamics:</b> {'Massive Accumulation' if delta_change > 0 else 'Massive Distribution'}",
                        "whale", symbol, "info", 900
                    )

                await self.send_alert(
                    f"[{symbol}] 🐋 Whale Trade",
                    f"<b>Direction:</b> {side}\n<b>Size:</b> ${amount/1e6:.2f}M\n<b>Price:</b> ${price:,.2f}",
                    "whale", symbol, "info", 60
                )
            
            # Update Volume Profile & VA
            profile = self.state[symbol]["volume_profile"]
            bucket_size = 10 if price > 1000 else (0.1 if price > 10 else 0.001)
            bucket = round(price / bucket_size) * bucket_size
            profile[bucket] = profile.get(bucket, 0) + amount
            
            # Simple VAH/VAL check if we have enough data (approx 100 buckets)
            if len(profile) > 100:
                # Calculate VAH/VAL (70% volume)
                sorted_prices = sorted(profile.keys())
                total_vol = sum(profile.values())
                target = total_vol * 0.7
                
                poc = max(profile, key=profile.get)
                poc_idx = sorted_prices.index(poc)
                
                acc_vol = profile[poc]
                up = poc_idx + 1
                down = poc_idx - 1
                while acc_vol < target and (up < len(sorted_prices) or down >= 0):
                    u_v = profile[sorted_prices[up]] if up < len(sorted_prices) else -1
                    d_v = profile[sorted_prices[down]] if down >= 0 else -1
                    if u_v > d_v: acc_vol += u_v; up += 1
                    else: acc_vol += d_v; down -= 1
                
                vah = sorted_prices[min(up, len(sorted_prices)-1)]
                val = sorted_prices[max(down, 0)]
                
                # Alert on breakout
                old_vah = self.state[symbol]["last_vah"]
                old_val = self.state[symbol]["last_val"]
                if old_vah > 0:
                    if price > vah and self.state[symbol]["last_price"] <= vah:
                        await self.send_alert(f"[{symbol}] 📈 VA Breakout (High)", f"Price ${price:,.2f} breaking above VAH ${vah:,.2f}", "level_testing", symbol, "info", 3600)
                    elif price < val and self.state[symbol]["last_price"] >= val:
                        await self.send_alert(f"[{symbol}] 📉 VA Breakout (Low)", f"Price ${price:,.2f} breaking below VAL ${val:,.2f}", "level_testing", symbol, "info", 3600)
                
                self.state[symbol]["last_vah"] = vah
                self.state[symbol]["last_val"] = val

            # 3. Custom Price Alerts
            price_alerts = self.config.get("priceAlerts", [])
            active_alerts = [a for a in price_alerts if a.get("symbol") == symbol]
            
            for alert in active_alerts:
                alert_price = float(alert.get("price"))
                alert_id = alert.get("id")
                last_price = self.state[symbol].get("last_price_for_alerts", price)
                
                # Check for crossing (Upwards or Downwards)
                hit = False
                if last_price < alert_price <= price: hit = True # Cross up
                elif last_price > alert_price >= price: hit = True # Cross down
                
                if hit:
                    logger.info(f"🔔 ALERT HIT: {symbol} at ${price:,.2f} (Target: ${alert_price:,.2f})")
                    await self.send_alert(
                        f"[{symbol}] 🔔 PRICE ALERT HIT",
                        f"<b>Target:</b> ${alert_price:,.2f}\n<b>Current:</b> ${price:,.2f}\n<b>Status:</b> Level reached.",
                        "price_alert", symbol, "warning", 10 # Short cooldown
                    )
                    # Trigger removal of the alert from bot.py
                    async with ClientSession() as session:
                        try:
                            async with session.post(f"{self.bot_url}/alerts/price", json={"action": "remove", "id": alert_id}) as resp:
                                if resp.status == 200:
                                    logger.info(f"Successfully removed alert {alert_id} from backend.")
                                else:
                                    logger.error(f"Failed to remove alert {alert_id}: Status {resp.status}")
                        except Exception as e:
                            logger.error(f"Error requesting alert removal: {e}")
            
            self.state[symbol]["last_price_for_alerts"] = price


        # 3. Open Interest Flow History
        elif stream == "openInterestUpdate": # Stream name is openInterestUpdate
            now = time.time()
            self.state[symbol]["oi_history"].append({'t': now, 'v': float(data['o'])})
            self.state[symbol]["oi_history"] = [h for h in self.state[symbol]["oi_history"] if now - h['t'] <= 1800] # 30m window
            
            # --- 5m OI Spike Detection (Matches useSmartAlerts.ts) ---
            window_5m = [h for h in self.state[symbol]["oi_history"] if now - h['t'] <= 300]
            if len(window_5m) > 1:
                oldest = window_5m[0]['v']
                newest = window_5m[-1]['v']
                if oldest > 0:
                    oi_change_pct = ((newest - oldest) / abs(oldest)) * 100
                    
                    thresholds = self.config.get("thresholds", {}).get(symbol, 
                                 self.config.get("thresholds", {}).get("global", {}))
                    oi_threshold = float(thresholds.get("oiSpikePercentage", 1.5))
                    
                    if abs(oi_change_pct) > oi_threshold:
                         is_up = oi_change_pct > 0
                         title = "OI SPIKE DETECTED" if is_up else "OI FLUSH DETECTED"
                         icon = "🌋" if is_up else "💧"
                         cooldown = self.config.get("cooldowns", {}).get("oi_spike", 600)
                         await self.send_alert(
                            f"[{symbol}] {icon} {title}",
                            f"Open Interest {'increased' if is_up else 'dropped'} by {abs(oi_change_pct):.2f}% in 5m.",
                            "oi_spike", symbol, "info", cooldown
                         )

        # 4. Funding Rate
        elif stream == "markPriceUpdate":
            rate = float(data['r'])
            old_rate = self.state[symbol]["funding_rate"]
            self.state[symbol]["funding_rate"] = rate
            
            thresholds = self.config.get("thresholds", {}).get(symbol, 
                         self.config.get("thresholds", {}).get("global", {}))
            extreme = float(thresholds.get("fundingExtremeRate", 0.05)) / 100 # Frontend sends 0.05 for 0.05%
            
            if abs(rate) >= extreme and abs(old_rate) < extreme:
                direction = "🟢 POSITIVE" if rate > 0 else "🔴 NEGATIVE"
                await self.send_alert(
                    f"[{symbol}] 🚨 Funding Extreme",
                    f"<b>Direction:</b> {direction}\n<b>Rate:</b> {rate*100:.4f}%\n<b>Context:</b> Leverage becoming unbalanced.",
                    "extreme_funding", symbol, "warning", 14400
                )

        # 4. Liquidations
        elif stream == "forceOrder":
            o = data['o']
            amount = float(o['p']) * float(o['q'])
            thresholds = self.config.get("thresholds", {}).get(symbol, 
                         self.config.get("thresholds", {}).get("global", {}))
            threshold = float(thresholds.get("liquidationMinAmount", 1000000))
            
            if amount >= threshold:
                side = o['S']
                await self.send_alert(
                    f"[{symbol}] 💥 Liquidation",
                    f"<b>Side:</b> {side}\n<b>Amount:</b> ${amount/1e6:.2f}M\n<b>Price:</b> ${float(o['p']):,.2f}",
                    "liquidation", symbol, "warning", 30
                )

        # 5. Klines (MTF & State Change)
        elif stream == "kline":
            k = data['k']
            tf = k['i']
            if not k['x']: return # Wait for candle close
            
            # Maintain history
            self.state[symbol]["klines"][tf].append([k['t'], k['o'], k['h'], k['l'], k['c'], k['v']])
            if len(self.state[symbol]["klines"][tf]) > 50:
                self.state[symbol]["klines"][tf].pop(0)

            if len(self.state[symbol]["klines"][tf]) >= 30:
                ema21, ema50, rsi, atr_ratio, rvol, vwap, poc = self.calculate_indicators(symbol, tf)
                price = float(k['c'])
                
                # A. Volatility State Shift
                vol_state = "Normal"
                thresholds = self.config.get("thresholds", {}).get(symbol, 
                             self.config.get("thresholds", {}).get("global", {}))
                
                exp_ratio = float(thresholds.get("atrExpansionRatio", 1.3))
                if atr_ratio > exp_ratio * 1.25: vol_state = "Extreme"
                elif atr_ratio > exp_ratio: vol_state = "Expanding"
                elif atr_ratio < 0.75: vol_state = "Squeeze/Compacting"
                
                old_vol = self.state[symbol]["volatility"].get(tf, "Unknown")
                if vol_state != old_vol:
                    color = "⚠️" if vol_state in ["Extreme", "Squeeze/Compacting"] else "🌊"
                    await self.send_alert(
                        f"[{symbol}] {color} Volatility Shift ({tf})",
                        f"<b>State:</b> {old_vol} → {vol_state}\n<b>ATR Ratio:</b> {atr_ratio:.2f}x\n<b>Risk:</b> {'High' if vol_state != 'Normal' else 'Low'}",
                        "atr_expand", symbol, "info", 300, tf=tf
                    )
                self.state[symbol]["volatility"][tf] = vol_state

                # B. Regime & Bias Shift
                new_regime = "Range"
                sep = abs(ema21 - ema50) / ema50 * 100
                thresholds = self.config.get("thresholds", {}).get(symbol, 
                             self.config.get("thresholds", {}).get("global", {}))
                sep_threshold = float(thresholds.get("emaSeparationPct", 0.15))
                strength = "Strong" if sep > sep_threshold else "Weak"
                
                if price > ema21 > ema50: new_regime = f"Uptrend ({strength})"
                elif price < ema21 < ema50: new_regime = f"Downtrend ({strength})"
                
                old_regime = self.state[symbol]["regime"].get(tf, "Unknown")
                if new_regime != old_regime:
                    icon = "🟢" if "Uptrend" in new_regime else ("🔴" if "Downtrend" in new_regime else "⚖️")
                    await self.send_alert(
                        f"[{symbol}] {icon} Regime Shift ({tf})",
                        f"<b>Bias:</b> {old_regime} → {new_regime}\n<b>RSI:</b> {rsi:.1f}\n<b>EMA Sep:</b> {sep:.2f}%",
                        "ema_cross", symbol, "info", 900, tf=tf
                    )
                self.state[symbol]["regime"][tf] = new_regime

                # B2. RSI Extremes
                rsi_ob = float(thresholds.get("rsiOverbought", 70))
                rsi_os = float(thresholds.get("rsiOversold", 30))
                
                old_rsi_state = self.state[symbol].get("rsi_state", {}).get(tf, "Neutral")
                new_rsi_state = "Neutral"
                if rsi >= rsi_ob: new_rsi_state = "Overbought"
                elif rsi <= rsi_os: new_rsi_state = "Oversold"
                
                if new_rsi_state != old_rsi_state and new_rsi_state != "Neutral":
                    rsi_icon = "🔥" if new_rsi_state == "Overbought" else "🧊"
                    await self.send_alert(
                        f"[{symbol}] {rsi_icon} RSI Extreme ({tf})",
                        f"<b>State:</b> {new_rsi_state}\n<b>Current RSI:</b> {rsi:.1f}",
                        "rsi_extreme", symbol, "info", 600, tf=tf
                    )
                self.state[symbol].setdefault("rsi_state", {})[tf] = new_rsi_state

                # B3. Relative Volume (RVOL) Spike
                rvol_mult = float(thresholds.get("rvolMultiplier", 3.0))
                if rvol >= rvol_mult:
                     await self.send_alert(
                        f"[{symbol}] 🌋 RVOL Spike ({tf})",
                        f"<b>Relative Volume:</b> {rvol:.1f}x average\n<b>Price:</b> ${price:,.2f}",
                        "rvol_spike", symbol, "info", 600, tf=tf
                    )

                # C. Positioning & Flow Shift (15m window typically)
                if tf == "15m" and len(self.state[symbol]["oi_history"]) >= 2:
                    oi_history = self.state[symbol]["oi_history"]
                    oi_delta = ((oi_history[-1]['v'] - oi_history[0]['v']) / oi_history[0]['v']) * 100
                    price_delta = ((price - float(self.state[symbol]["klines"][tf][0][1])) / float(self.state[symbol]["klines"][tf][0][1])) * 100
                    
                    thresholds = self.config.get("thresholds", {}).get(symbol, 
                                 self.config.get("thresholds", {}).get("global", {}))
                    oi_threshold = float(thresholds.get("oiSpikePercentage", 1.5))
                    
                    flow = "Neutral/Stable"
                    if abs(oi_delta) > oi_threshold:
                        if oi_delta > 0 and price_delta > 0: flow = "Active Long Building"
                        elif oi_delta > 0 and price_delta < 0: flow = "Active Short Building"
                        elif oi_delta < 0 and price_delta > 0: flow = "Short Covering Rally"
                        elif oi_delta < 0 and price_delta < 0: flow = "Long Liquidations"
                    
                    old_flow = self.state[symbol]["flow"].get(tf, "Unknown")
                    if flow != old_flow and flow != "Neutral/Stable":
                        await self.send_alert(
                            f"[{symbol}] 📊 Flow Shift ({tf})",
                            f"<b>Dynamics:</b> {flow}\n<b>OI Delta:</b> {oi_delta:+.2f}%\n<b>Price Delta:</b> {price_delta:+.2f}%",
                            "order_flow", symbol, "info", 900, tf=tf
                        )
                    self.state[symbol]["flow"][tf] = flow

                # D. Level Interaction Interaction
                levels = [("POC", poc), ("VWAP", vwap)]
                active_level = "In Vacuum"
                for name, l_price in levels:
                    dist = abs(price - l_price) / l_price * 100
                    if dist < 0.05:
                        active_level = f"Consolidating at {name}"
                        break
                    elif dist < 0.15:
                        active_level = f"Testing {name}"
                        break
                
                old_level = self.state[symbol]["levels"].get(tf, "Unknown")
                if active_level != old_level and active_level != "In Vacuum":
                    await self.send_alert(
                        f"[{symbol}] 🎯 Level Interaction ({tf})",
                        f"<b>Status:</b> {active_level}\n<b>Price:</b> ${price:,.2f}",
                        "level_testing", symbol, "info", 600, tf=tf
                    )
                self.state[symbol]["levels"][tf] = active_level

                # E. Context Summary Shift Evaluator
                if True: # Run for all TFs, but only alert if enabled in config for that TF
                    st = self.state[symbol]
                    regime = st.get("regime", {}).get(tf, "Unknown")
                    flow = st.get("flow", {}).get(tf, "Unknown")
                    volatility = st.get("volatility", {}).get(tf, "Unknown")
                    execution = st.get("execution", "Unknown")
                    
                    new_summary_hash = f"{regime}|{flow}|{volatility}"
                    
                    if "summary_hash" not in self.state[symbol]: 
                        self.state[symbol]["summary_hash"] = {}
                        
                    old_summary_hash = self.state[symbol]["summary_hash"].get(tf, "Unknown")
                    
                    # Only alert if we actually have state built up and it changes
                    if new_summary_hash != old_summary_hash and old_summary_hash != "Unknown" and regime != "Unknown":
                        msg = (
                            f"<b>{regime} → {flow}</b>\n\n"
                            f"<b>Regime & Bias:</b> {regime}\n"
                            f"<b>Volatility:</b> {volatility}\n"
                            f"<b>Positioning:</b> {flow}"
                        )
                        await self.send_alert(
                            f"[{symbol}] ⚡ Context Summary Shift ({tf})",
                            msg,
                            "context_summary", symbol, "info", 900, tf=tf
                        )
                    self.state[symbol]["summary_hash"][tf] = new_summary_hash
            
            # F. Daily Wrap-Up (Check once per minute)
            now_dt = datetime.now(timezone.utc)
            if now_dt.hour == 0 and now_dt.minute == 0:
                last_wrap = self.state[symbol].get("last_daily_wrap", 0)
                if time.time() - last_wrap > 80000: # Ensure only once per day
                    price = self.state[symbol]["last_price"]
                    whale_flow = self.state[symbol]["whale_delta"]
                    
                    if price > 0:
                        await self.send_alert(
                            f"[{symbol}] 📅 Daily Market Wrap",
                            f"<b>Closing Price:</b> ${price:,.2f}\n<b>Whale Net Flow:</b> ${whale_flow/1e6:+.2f}M\n<b>Funding Rate:</b> {self.state[symbol]['funding_rate']*100:.4f}%",
                            "market_context", symbol, "info", 3600
                        )
                    self.state[symbol]["last_daily_wrap"] = time.time()

            # G. 4-Hour Periodic Summary (Check once per minute)
            last_periodic = self.state[symbol].get("last_periodic_summary", 0)
            if time.time() - last_periodic > 14400: # 4 hours
                regime = self.state[symbol]["regime"].get("1h", "Unknown")
                volatility = self.state[symbol]["volatility"].get("1h", "Unknown")
                flow = self.state[symbol]["flow"].get("1h", "Unknown")
                price = self.state[symbol]["last_price"]
                
                msg = (
                    f"<b>Regime:</b> {regime}\n"
                    f"<b>Volatility:</b> {volatility}\n"
                    f"<b>Positioning:</b> {flow}\n"
                    f"<b>Price:</b> ${price:,.2f}"
                )
                
                # Only send if we have actual data
                if regime != "Unknown" and volatility != "Unknown":
                    await self.send_alert(
                        f"[{symbol}] 🧭 Market Context Summary",
                        msg,
                        "market_context", symbol, "info", 3600
                    )
                    self.state[symbol]["last_periodic_summary"] = time.time()
                else:
                    # If we don't have data yet, defer the first summary slightly to allow klines to populate
                    self.state[symbol]["last_periodic_summary"] = time.time() - 10800 # Try again in 1 hour

    async def run(self):
        """Starts the engine tasks."""
        # 1. Initial config fetch
        await self.get_bot_config()
        
        # 2. Start workers
        await asyncio.gather(
            self.monitor_ws(),
            self.periodic_config_sync()
        )

    async def periodic_config_sync(self):
        """Keeps in-memory config fresh every 10s."""
        while True:
            await self.get_bot_config()
            await asyncio.sleep(10)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    engine = MarketEngine()
    asyncio.run(engine.run())
