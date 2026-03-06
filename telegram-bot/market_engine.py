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
from debounce import debounced_state_change as apply_debounced_state_change, threshold_trigger

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

    def debounced_state_change(self, symbol, bucket, tf, candidate, confirmations=2):
        """Require repeated confirmation before committing a state transition."""
        symbol_state = self.state.setdefault(symbol, {})
        symbol_state.setdefault(bucket, {})
        symbol_state.setdefault("debounce", {})
        current = symbol_state[bucket].get(tf, "Unknown")
        next_state, changed = apply_debounced_state_change(
            debounce_state=symbol_state["debounce"],
            key=f"{bucket}:{tf}",
            current=current,
            candidate=candidate,
            confirmations=confirmations,
        )
        if changed:
            symbol_state[bucket][tf] = next_state
        return current, next_state, changed

    def should_fire_threshold(self, symbol, key, condition, enter_confirmations=2, exit_confirmations=2):
        """Latch threshold alerts until the condition is clearly reset."""
        symbol_state = self.state.setdefault(symbol, {})
        symbol_state.setdefault("threshold_latches", {})
        return threshold_trigger(
            threshold_state=symbol_state["threshold_latches"],
            key=key,
            condition=condition,
            enter_confirmations=enter_confirmations,
            exit_confirmations=exit_confirmations,
        )
        
    async def get_bot_config(self):
        """Polls the bot for updated configuration."""
        async with ClientSession() as session:
            try:
                async with session.get(f"{self.bot_url}/config") as resp:
                    if resp.status == 200:
                        self.config = await resp.json()
                        self.monitored_symbols = self.config.get("monitoredSymbols", WATCH_SYMBOLS)
                        # logger.info("Engine synced with latest bot configuration.")
            except Exception as e:
                logger.error(f"Failed to fetch config from bot: {e}")

    async def fetch_historical_klines(self, symbol, timeframe, limit=100):
        """Fetches historical klines from Binance REST API."""
        url = f"{BINANCE_API}/fapi/v1/klines"
        params = {
            "symbol": symbol,
            "interval": timeframe,
            "limit": limit
        }
        async with ClientSession() as session:
            try:
                async with session.get(url, params=params) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Format: [t, o, h, l, c, v, ...] -> we need [t, o, h, l, c, v]
                        return [[k[0], k[1], k[2], k[3], k[4], k[5]] for k in data]
                    else:
                        logger.error(f"Failed to fetch history for {symbol} {timeframe}: {resp.status}")
            except Exception as e:
                logger.error(f"Error fetching history: {e}")
        return []

    async def init_symbol_state(self, symbol):
        """Initializes state and fetches history for a new symbol."""
        if symbol in self.state: return
        
        logger.info(f"Initializing state for {symbol}...")
        self.state[symbol] = {
            "last_price": 0,
            "whale_delta": 0,
            "volume_profile": {},
            "last_vah": 0,
            "last_val": 0,
            "oi_history": [],
            "regime": {},
            "flow": {},
            "volatility": {},
            "levels": {},
            "klines": {tf: [] for tf in ALL_TIMEFRAMES},
            "funding_rate": 0,
            "rsi_state": {},
            "summary_hash": {},
            "debounce": {},
            "threshold_latches": {},
        }
        
        # Fetch history for all timeframes to populate indicators immediately
        tasks = []
        for tf in ALL_TIMEFRAMES:
            tasks.append(self.fetch_historical_klines(symbol, tf))
        
        results = await asyncio.gather(*tasks)
        for i, tf in enumerate(ALL_TIMEFRAMES):
            self.state[symbol]["klines"][tf] = results[i]
            if results[i]:
                # Pre-calculate indicators if we have enough data
                try:
                    self.calculate_indicators(symbol, tf)
                except Exception as e:
                    logger.debug(f"Initial indicators failed for {symbol} {tf}: {e}")

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
        """Proxies alerts to bot API; policy checks are centralized in bot.py."""

        session_name = self.get_active_session()
        payload = {
            "message": f"<b>🚨 {title}</b>\n\n{message}\n\n<i>Session: {session_name}</i>",
            "type": category,
            "category": category,
            "severity": severity,
            "symbol": symbol,
            "cooldown": cooldown,
            "tf": tf
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
        if len(df) >= 50:
            ema21 = df['c'].ewm(span=21, adjust=False).mean().iloc[-1]
            ema50 = df['c'].ewm(span=50, adjust=False).mean().iloc[-1]
        else:
            ema21 = ema50 = df['c'].iloc[-1]
        
        # RSI
        if len(df) >= 15:
            delta = df['c'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs)).iloc[-1]
        else:
            rsi = 50.0
        
        # ATR Ratio (Current TR / SMA 20 of TR)
        df['tr'] = np.maximum(df['h'] - df['l'], np.maximum(abs(df['h'] - df['c'].shift(1)), abs(df['l'] - df['c'].shift(1))))
        if len(df) >= 20:
            atr_ratio = df['tr'].iloc[-1] / df['tr'].rolling(20).mean().iloc[-1]
        else:
            atr_ratio = 1.0
        
        # RVOL (Current Volume / SMA 20 of Volume)
        if len(df) >= 20:
            rvol = df['v'].iloc[-1] / df['v'].rolling(20).mean().iloc[-1]
        else:
            rvol = 1.0

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
                        "summary_hash": {}, "last_daily_wrap": 0, "last_periodic_summary": 0,
                        "debounce": {}, "threshold_latches": {}
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
        elif stream == "openInterestUpdate":
            now = time.time()
            self.state[symbol]["oi_history"].append({'t': now, 'v': float(data['o'])})
            # Keep 1 hour of OI history for MTF support (max window 1h)
            self.state[symbol]["oi_history"] = [h for h in self.state[symbol]["oi_history"] if now - h['t'] <= 3600]
            
            # --- MTF OI Spike Detection ---
            # Check enabled timeframes for 'oi_spike'
            enabled_tfs = self.config.get("timeframes", {}).get("oi_spike", ["5m"])
            
            seconds_map = {
                "1m": 60,
                "3m": 180,
                "5m": 300,
                "15m": 900,
                "30m": 1800
            }
            
            thresholds = self.config.get("thresholds", {}).get(symbol, 
                         self.config.get("thresholds", {}).get("global", {}))
            oi_threshold = float(thresholds.get("oiSpikePercentage", 1.5))
            cooldown = self.config.get("cooldowns", {}).get("oi_spike", 600)
            
            for tf_str in enabled_tfs:
                if tf_str not in seconds_map: continue
                window_seconds = seconds_map[tf_str]
                
                window = [h for h in self.state[symbol]["oi_history"] if now - h['t'] <= window_seconds]
                if len(window) > 1:
                    oldest = window[0]['v']
                    newest = window[-1]['v']
                    if oldest > 0:
                        oi_change_pct = ((newest - oldest) / abs(oldest)) * 100
                        
                        condition = abs(oi_change_pct) > oi_threshold
                        should_fire = self.should_fire_threshold(
                            symbol=symbol,
                            key=f"oi_spike:{tf_str}",
                            condition=condition,
                            enter_confirmations=2,
                            exit_confirmations=2,
                        )

                        if should_fire:
                            is_up = oi_change_pct > 0
                            title = f"OI SPIKE DETECTED ({tf_str})" if is_up else f"OI FLUSH DETECTED ({tf_str})"
                            icon = "UP" if is_up else "DOWN"

                            await self.send_alert(
                                f"[{symbol}] {icon} {title}",
                                f"Open Interest {'increased' if is_up else 'dropped'} by {abs(oi_change_pct):.2f}% in {tf_str}.",
                                "oi_spike", symbol, "info", cooldown, tf=tf_str
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
            now = time.time()
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
                
                old_vol, next_vol, vol_changed = self.debounced_state_change(
                    symbol=symbol,
                    bucket="volatility",
                    tf=tf,
                    candidate=vol_state,
                    confirmations=2,
                )
                if vol_changed:
                    color = "HIGH-RISK" if next_vol in ["Extreme", "Squeeze/Compacting"] else "SHIFT"
                    await self.send_alert(
                        f"[{symbol}] {color} Volatility Shift ({tf})",
                        f"<b>State:</b> {old_vol} -> {next_vol}\n<b>ATR Ratio:</b> {atr_ratio:.2f}x\n<b>Risk:</b> {'High' if next_vol != 'Normal' else 'Low'}",
                        "atr_expand", symbol, "info", 300, tf=tf
                    )

                # B. Regime & Bias Shift
                new_regime = "Range"
                sep = abs(ema21 - ema50) / ema50 * 100
                thresholds = self.config.get("thresholds", {}).get(symbol, 
                             self.config.get("thresholds", {}).get("global", {}))
                sep_threshold = float(thresholds.get("emaSeparationPct", 0.15))
                strength = "Strong" if sep > sep_threshold else "Weak"
                
                if price > ema21 > ema50: new_regime = f"Uptrend ({strength})"
                elif price < ema21 < ema50: new_regime = f"Downtrend ({strength})"
                
                old_regime, next_regime, regime_changed = self.debounced_state_change(
                    symbol=symbol,
                    bucket="regime",
                    tf=tf,
                    candidate=new_regime,
                    confirmations=2,
                )
                if regime_changed:
                    icon = "BULL" if "Uptrend" in next_regime else ("BEAR" if "Downtrend" in next_regime else "RANGE")
                    await self.send_alert(
                        f"[{symbol}] {icon} Regime Shift ({tf})",
                        f"<b>Bias:</b> {old_regime} -> {next_regime}\n<b>RSI:</b> {rsi:.1f}\n<b>EMA Sep:</b> {sep:.2f}%",
                        "ema_cross", symbol, "info", 900, tf=tf
                    )

                # B2. RSI Extremes
                rsi_ob = float(thresholds.get("rsiOverbought", 70))
                rsi_os = float(thresholds.get("rsiOversold", 30))
                new_rsi_state = "Neutral"
                if rsi >= rsi_ob: new_rsi_state = "Overbought"
                elif rsi <= rsi_os: new_rsi_state = "Oversold"
                
                old_rsi_state, next_rsi_state, rsi_changed = self.debounced_state_change(
                    symbol=symbol,
                    bucket="rsi_state",
                    tf=tf,
                    candidate=new_rsi_state,
                    confirmations=2,
                )
                if rsi_changed and next_rsi_state != "Neutral" and old_rsi_state != "Unknown":
                    rsi_icon = "OVERBOUGHT" if next_rsi_state == "Overbought" else "OVERSOLD"
                    await self.send_alert(
                        f"[{symbol}] {rsi_icon} RSI Extreme ({tf})",
                        f"<b>State:</b> {next_rsi_state}\n<b>Current RSI:</b> {rsi:.1f}\n<b>Threshold:</b> {rsi_ob if next_rsi_state == 'Overbought' else rsi_os}",
                        "rsi_extreme", symbol, "info", 600, tf=tf
                    )

                # B3. Relative Volume (RVOL) Spike
                rvol_mult = float(thresholds.get("rvolMultiplier", 3.0))
                rvol_condition = rvol >= rvol_mult
                rvol_fire = self.should_fire_threshold(
                    symbol=symbol,
                    key=f"rvol_spike:{tf}",
                    condition=rvol_condition,
                    enter_confirmations=2,
                    exit_confirmations=2,
                )
                if rvol_fire:
                    await self.send_alert(
                        f"[{symbol}] RVOL Spike ({tf})",
                        f"<b>Relative Volume:</b> {rvol:.1f}x average\n<b>Price:</b> ${price:,.2f}",
                        "rvol_spike", symbol, "info", 600, tf=tf
                    )

                # C. Positioning & Flow Shift (MTF)
                enabled_flow_tfs = self.config.get("timeframes", {}).get("order_flow", ["15m"])
                if tf in enabled_flow_tfs and len(self.state[symbol]["oi_history"]) >= 2:
                    oi_history = self.state[symbol]["oi_history"]
                    # Get OI from start of this candle timeframe
                    window_seconds = 60 if tf == "1m" else (300 if tf == "5m" else 900) # Simple map for common TFs
                    if tf == "1h": window_seconds = 3600
                    
                    # Search for OI at start of interval
                    oi_start_window = [h for h in oi_history if (now - h['t']) >= window_seconds]
                    if oi_start_window:
                        oi_start = oi_start_window[-1]['v']
                        oi_now = oi_history[-1]['v']
                        oi_delta = ((oi_now - oi_start) / oi_start) * 100
                        
                        price_start = float(self.state[symbol]["klines"][tf][0][1])
                        price_delta = ((price - price_start) / price_start) * 100
                        
                        oi_threshold = float(thresholds.get("oiSpikePercentage", 1.5))
                        
                        flow = "Neutral/Stable"
                        if abs(oi_delta) > oi_threshold:
                            if oi_delta > 0 and price_delta > 0: flow = "Active Long Building"
                            elif oi_delta > 0 and price_delta < 0: flow = "Active Short Building"
                            elif oi_delta < 0 and price_delta > 0: flow = "Short Covering Rally"
                            elif oi_delta < 0 and price_delta < 0: flow = "Long Liquidations"
                        
                        old_flow, next_flow, flow_changed = self.debounced_state_change(
                            symbol=symbol,
                            bucket="flow",
                            tf=tf,
                            candidate=flow,
                            confirmations=2,
                        )
                        if flow_changed and next_flow != "Neutral/Stable":
                            await self.send_alert(
                                f"[{symbol}] Flow Shift ({tf})",
                                f"<b>Dynamics:</b> {next_flow}\n<b>OI Delta:</b> {oi_delta:+.2f}%\n<b>Price Delta:</b> {price_delta:+.2f}%",
                                "order_flow", symbol, "info", 900, tf=tf
                            )

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
                
                old_level, next_level, level_changed = self.debounced_state_change(
                    symbol=symbol,
                    bucket="levels",
                    tf=tf,
                    candidate=active_level,
                    confirmations=2,
                )
                if level_changed and next_level != "In Vacuum":
                    await self.send_alert(
                        f"[{symbol}] Level Interaction ({tf})",
                        f"<b>Status:</b> {next_level}\n<b>Price:</b> ${price:,.2f}",
                        "level_testing", symbol, "info", 600, tf=tf
                    )

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
                        
                    old_summary_hash, next_summary_hash, summary_changed = self.debounced_state_change(
                        symbol=symbol,
                        bucket="summary_hash",
                        tf=tf,
                        candidate=new_summary_hash,
                        confirmations=2,
                    )

                    # Only alert if we actually have state built up and it changes
                    if summary_changed and old_summary_hash != "Unknown" and regime != "Unknown":
                        msg = (
                            f"<b>{regime} -> {flow}</b>\n\n"
                            f"<b>Regime & Bias:</b> {regime}\n"
                            f"<b>Volatility:</b> {volatility}\n"
                            f"<b>Positioning:</b> {flow}"
                        )
                        await self.send_alert(
                            f"[{symbol}] Context Summary Shift ({tf})",
                            msg,
                            "context_summary", symbol, "info", 900, tf=tf
                        )
            
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
        
        # 2. Initialize symbols from config
        init_tasks = [self.init_symbol_state(s) for s in self.monitored_symbols]
        if init_tasks:
            await asyncio.gather(*init_tasks)
        
        # 3. Start workers
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
