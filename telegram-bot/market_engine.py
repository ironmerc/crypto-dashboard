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
            enabled_tfs = self.config.get("timeframes", {}).get(category, ["5m", "15m", "1h", "4h"])
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
                        "klines": {"15m": [], "1h": [], "4h": []},
                        "rsi": {"15m": 50, "1h": 50, "4h": 50},
                        "oi_history": [], "spread_history": []
                    }

            streams = []
            for s in current_symbols:
                sym = s.lower()
                streams.extend([
                    f"{sym}@aggTrade",
                    f"{sym}@forceOrder",
                    f"{sym}@kline_15m",
                    f"{sym}@kline_1h",
                    f"{sym}@kline_4h",
                    f"{sym}@bookTicker",
                    f"{sym}@openInterest"
                ])
            
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
                await self.send_alert(
                    f"[{symbol}] 🐋 Whale Trade",
                    f"<b>Direction:</b> {side}\n<b>Size:</b> ${amount/1e6:.2f}M\n<b>Price:</b> ${price:,.2f}",
                    "whale", symbol, "info", 60
                )

        # 2. Execution Context (Spread)
        elif stream == "bookTicker":
            bids = float(data['b'])
            asks = float(data['a'])
            price = (bids + asks) / 2
            spread_pct = (asks - bids) / price * 100
            
            # Categorize
            quality = "Tight" if spread_pct < 0.01 else ("Good" if spread_pct < 0.05 else "Wide")
            old_quality = self.state[symbol].get("execution", "Unknown")
            
            if quality != old_quality:
                # Limit execution alerts to once every 10m to avoid chop
                await self.send_alert(
                    f"[{symbol}] ⚡ Execution Context Shift",
                    f"<b>Spread:</b> {old_quality} → {quality}\n<b>Raw Pct:</b> {spread_pct:.4f}%",
                    "execution_quality", symbol, "info", 600
                )
            self.state[symbol]["execution"] = quality

        # 3. Open Interest Flow History
        elif stream == "openInterestUpdate": # Stream name is openInterestUpdate
            oi = float(data['o'])
            self.state[symbol]["oi_history"].append({"t": time.time(), "v": oi})
            # Keep 30m window
            now = time.time()
            self.state[symbol]["oi_history"] = [h for h in self.state[symbol]["oi_history"] if now - h['t'] <= 1800]

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
                        "volatility_state", symbol, "info", 300, tf=tf
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
                        "regime_shift", symbol, "info", 900, tf=tf
                    )
                self.state[symbol]["regime"][tf] = new_regime

                # C. Positioning & Flow Shift (15m window typically)
                if tf == "15m" and len(self.state[symbol]["oi_history"]) >= 2:
                    oi_history = self.state[symbol]["oi_history"]
                    oi_delta = ((oi_history[-1]['v'] - oi_history[0]['v']) / oi_history[0]['v']) * 100
                    price_delta = ((price - float(self.state[symbol]["klines"][tf][0][1])) / float(self.state[symbol]["klines"][tf][0][1])) * 100
                    
                    thresholds = self.config.get("thresholds", {}).get(symbol, 
                                 self.config.get("thresholds", {}).get("global", {}))
                    oi_threshold = float(thresholds.get("oiSpikePercentage", 0.4))
                    
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
                    
                    new_summary_hash = f"{regime}|{flow}|{volatility}|{execution}"
                    
                    if "summary_hash" not in self.state[symbol]: 
                        self.state[symbol]["summary_hash"] = {}
                        
                    old_summary_hash = self.state[symbol]["summary_hash"].get(tf, "Unknown")
                    
                    # Only alert if we actually have state built up and it changes
                    if new_summary_hash != old_summary_hash and old_summary_hash != "Unknown" and regime != "Unknown":
                        msg = (
                            f"<b>{regime} → {flow}</b>\n\n"
                            f"<b>Regime & Bias:</b> {regime}\n"
                            f"<b>Volatility:</b> {volatility}\n"
                            f"<b>Positioning:</b> {flow}\n"
                            f"<b>Execution Context:</b> {execution}"
                        )
                        await self.send_alert(
                            f"[{symbol}] ⚡ Context Summary Shift ({tf})",
                            msg,
                            "context_summary", symbol, "info", 900, tf=tf
                        )
                    self.state[symbol]["summary_hash"][tf] = new_summary_hash

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
