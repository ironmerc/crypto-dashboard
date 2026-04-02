import asyncio
import json
import logging
import time
import os
from datetime import datetime, timezone
from collections import deque
from typing import Dict, List, Any, Tuple, Optional, Union, cast

import websockets
import pandas as pd
import numpy as np
from aiohttp import ClientSession

# Internal modules
try:
    from debounce import debounced_state_change as apply_debounced_state_change, threshold_trigger
    from alert_metadata import build_alert_metadata
except ImportError:
    # Fallback/Mock for environments where these might be missing during linting
    def apply_debounced_state_change(*args, **kwargs): return "Unknown", False
    def threshold_trigger(*args, **kwargs): return False
    def build_alert_metadata(*args, **kwargs): return {}

logger = logging.getLogger(__name__)

# Configurable Constants
WATCH_SYMBOLS = [{"symbol": "BTCUSDT", "type": "futures"}, {"symbol": "ETHUSDT", "type": "futures"}]
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws/"
BINANCE_SPOT_WS = "wss://stream.binance.com:9443/ws/"
BINANCE_FUTURES_API = "https://fapi.binance.com"
BINANCE_SPOT_API = "https://api.binance.com"
ALL_TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]

class MarketEngine:
    def __init__(self, bot_url: str = "http://localhost:8888"):
        self.bot_url = bot_url
        self.config: Dict[str, Any] = {}
        self.monitored_symbols: List[Dict[str, str]] = [] # List of {"symbol": "...", "type": "..."}
        self.state: Dict[str, Any] = {}
        self.ws_tasks: Dict[str, asyncio.Task] = {} # market_type -> task
        self.config_sync_task: Optional[asyncio.Task] = None

    def debounced_state_change(self, symbol: str, bucket: str, tf: str, candidate: str, confirmations: int = 2) -> Tuple[str, str, bool]:
        """Require repeated confirmation before committing a state transition."""
        symbol_state = self.state.setdefault(symbol, {})
        bucket_data = symbol_state.setdefault(bucket, {})
        debounce_data = symbol_state.setdefault("debounce", {})
        
        current = bucket_data.get(tf, "Unknown")
        next_state, changed = apply_debounced_state_change(
            debounce_state=debounce_data,
            key=f"{bucket}:{tf}",
            current=current,
            candidate=candidate,
            confirmations=confirmations,
        )
        if changed:
            bucket_data[tf] = next_state
        return current, next_state, changed

    def should_fire_threshold(self, symbol: str, key: str, condition: bool, enter_confirmations: int = 2, exit_confirmations: int = 2) -> bool:
        """Latch threshold alerts until the condition is clearly reset."""
        symbol_state = self.state.setdefault(symbol, {})
        latches = symbol_state.setdefault("threshold_latches", {})
        return threshold_trigger(
            threshold_state=latches,
            key=key,
            condition=condition,
            enter_confirmations=enter_confirmations,
            exit_confirmations=exit_confirmations,
        )
        
    async def get_bot_config(self) -> None:
        """Polls the bot for updated configuration."""
        async with ClientSession() as session:
            try:
                async with session.get(f"{self.bot_url}/config") as resp:
                    if resp.status == 200:
                        self.config = await resp.json()
                        raw_symbols = self.config.get("monitoredSymbols", WATCH_SYMBOLS)
                        # Normalize symbols to objects if they are strings (migration)
                        self.monitored_symbols = []
                        for s in raw_symbols:
                            if isinstance(s, str):
                                self.monitored_symbols.append({"symbol": s, "type": "futures"})
                            elif isinstance(s, dict) and "symbol" in s:
                                self.monitored_symbols.append(cast(Dict[str, str], s))
            except Exception as e:
                logger.error(f"Failed to fetch config from bot: {e}")

    async def fetch_historical_klines(self, symbol: str, timeframe: str, market_type: str = "futures", limit: int = 100) -> List[List[Any]]:
        """Fetches historical klines from Binance REST API (Spot or Futures)."""
        if market_type == "spot":
            url = f"{BINANCE_SPOT_API}/api/v3/klines"
        else:
            url = f"{BINANCE_FUTURES_API}/fapi/v1/klines"
            
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
                        logger.error(f"Failed to fetch history for {symbol} {timeframe} ({market_type}): {resp.status}")
            except Exception as e:
                logger.error(f"Error fetching history: {e}")
        return []

    async def init_symbol_state(self, symbol_obj: Dict[str, str]) -> None:
        """Initializes state and fetches history for a new symbol."""
        symbol = symbol_obj["symbol"]
        market_type = symbol_obj.get("type", "futures")
        
        if symbol in self.state: return
        
        logger.info(f"Initializing state for {symbol} ({market_type})...")
        self.state[symbol] = {
            "last_price": 0.0,
            "whale_delta": 0.0,
            "volume_profile": {},
            "last_vah": 0.0,
            "last_val": 0.0,
            "oi_history": [],
            "regime": {},
            "flow": {},
            "volatility": {},
            "levels": {},
            "klines": {tf: [] for tf in ALL_TIMEFRAMES},
            "funding_rate": 0.0,
            "rsi_state": {},
            "summary_hash": {},
            "debounce": {},
            "threshold_latches": {},
            "type": market_type
        }
        
        # Fetch history for all timeframes to populate indicators immediately
        tasks = []
        for tf in ALL_TIMEFRAMES:
            tasks.append(self.fetch_historical_klines(symbol, tf, market_type))
        
        results = await asyncio.gather(*tasks)
        for i, tf in enumerate(ALL_TIMEFRAMES):
            self.state[symbol]["klines"][tf] = results[i]
            if results[i]:
                try:
                    self.calculate_indicators(symbol, tf)
                except Exception as e:
                    logger.debug(f"Initial indicators failed for {symbol} {tf}: {e}")

    def get_active_session(self) -> str:
        """Determines the current market session based on UTC hour."""
        hour = datetime.now(timezone.utc).hour
        if 0 <= hour < 8: return "Asia"
        if 8 <= hour < 16: return "London"
        return "US"

    def is_session_active(self) -> bool:
        """Checks if the current session is allowed per user configuration."""
        current = self.get_active_session()
        allowed = self.config.get("activeSessions", ["London", "US", "Asia"])
        return current in allowed

    async def send_alert(
        self,
        title: str,
        message: str,
        category: str,
        symbol: str,
        severity: str = "info",
        cooldown: int = 60,
        tf: Optional[str] = None,
        reason: str = "rule_triggered",
        current_value: Any = None,
        threshold_value: Any = None,
        comparison: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        market_type: str = "futures"
    ) -> None:
        """Proxies alerts to bot API; policy checks are centralized in bot.py."""

        session_name = self.get_active_session()
        meta = build_alert_metadata(
            reason=reason,
            current_value=current_value,
            threshold_value=threshold_value,
            comparison=comparison,
            timeframe=tf,
            session=session_name,
            extra=metadata,
        )
        
        market_label = "[SPOT]" if market_type == "spot" else ""
        
        payload = {
            "message": f"<b>🚨 {market_label} {title}</b>\n\n{message}\n\n<i>Session: {session_name}</i>",
            "type": category,
            "category": category,
            "severity": severity,
            "symbol": symbol,
            "cooldown": cooldown,
            "tf": tf,
            "metadata": meta,
            "market_type": market_type
        }
        
        async with ClientSession() as session:
            try:
                async with session.post(f"{self.bot_url}/alert", json=payload) as resp:
                    if resp.status != 202:
                        logger.warning(f"Bot rejected alert: {await resp.text()}")
            except Exception as e:
                logger.error(f"Failed to send alert to bot: {e}")

    def calculate_indicators(self, symbol: str, tf: str) -> Dict[str, Any]:
        """Calculates indicators including ATR Ratio, RVOL, MACD, BB, and StochRSI."""
        klines = self.state[symbol]["klines"][tf]
        if not klines:
            return {"ema21": 0.0, "ema50": 0.0, "rsi": 50.0, "atr_ratio": 1.0, "rvol": 1.0,
                    "vwap": 0.0, "poc": 0.0, "macd": 0.0, "macd_signal": 0.0, "macd_hist": 0.0,
                    "bb_upper": 0.0, "bb_lower": 0.0, "bb_width": 0.0, "stoch_k": 50.0, "stoch_d": 50.0}

        df = pd.DataFrame(klines, columns=['t', 'o', 'h', 'l', 'c', 'v'])
        df['c'] = df['c'].astype(float)
        df['h'] = df['h'].astype(float)
        df['l'] = df['l'].astype(float)
        df['v'] = df['v'].astype(float)

        # EMA for Regime
        if len(df) >= 50:
            ema21 = float(df['c'].ewm(span=21, adjust=False).mean().iloc[-1])
            ema50 = float(df['c'].ewm(span=50, adjust=False).mean().iloc[-1])
        else:
            ema21 = ema50 = float(df['c'].iloc[-1])

        # RSI
        rsi = 50.0
        if len(df) >= 15:
            delta = df['c'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            with np.errstate(divide='ignore', invalid='ignore'):
                rs = gain / loss
                rsi_series = cast(pd.Series, 100 - (100 / (1 + rs)))
                rsi_val = rsi_series.iloc[-1]
                rsi = float(rsi_val) if not np.isnan(rsi_val) else 50.0

        # ATR Ratio (Current TR / SMA 20 of TR)
        df['tr'] = np.maximum(df['h'] - df['l'], np.maximum(abs(df['h'] - df['c'].shift(1)), abs(df['l'] - df['c'].shift(1))))
        atr_ratio = 1.0
        if len(df) >= 20:
            avg_tr = df['tr'].rolling(20).mean().iloc[-1]
            atr_ratio = float(df['tr'].iloc[-1] / avg_tr) if avg_tr != 0 else 1.0

        # RVOL (Current Volume / SMA 20 of Volume)
        rvol = 1.0
        if len(df) >= 20:
            avg_v = df['v'].rolling(20).mean().iloc[-1]
            rvol = float(df['v'].iloc[-1] / avg_v) if avg_v != 0 else 1.0

        # VWAP
        df['tp'] = (df['h'] + df['l'] + df['c']) / 3
        total_v = df['v'].sum()
        vwap = float((df['tp'] * df['v']).sum() / total_v) if total_v != 0 else float(df['c'].iloc[-1])

        # POC (Price at which most volume occurred)
        counts, bin_edges = np.histogram(df['c'], bins=50, weights=df['v'])
        poc = float(bin_edges[np.argmax(counts)])

        # MACD (12/26/9)
        macd_val = macd_signal = macd_hist = 0.0
        if len(df) >= 26:
            ema12 = df['c'].ewm(span=12, adjust=False).mean()
            ema26 = df['c'].ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            signal_line = macd_line.ewm(span=9, adjust=False).mean()
            macd_val = float(macd_line.iloc[-1])
            macd_signal = float(signal_line.iloc[-1])
            macd_hist = macd_val - macd_signal

        # Bollinger Bands (20, 2)
        bb_upper = bb_lower = bb_width = 0.0
        if len(df) >= 20:
            sma20 = df['c'].rolling(20).mean().iloc[-1]
            std20 = df['c'].rolling(20).std().iloc[-1]
            bb_upper = float(sma20 + 2 * std20)
            bb_lower = float(sma20 - 2 * std20)
            bb_width = float((bb_upper - bb_lower) / sma20 * 100) if sma20 != 0 else 0.0

        # StochRSI (14/14/3/3)
        stoch_k = stoch_d = 50.0
        if len(df) >= 28:
            delta2 = df['c'].diff()
            gain2 = delta2.where(delta2 > 0, 0).rolling(14).mean()
            loss2 = (-delta2.where(delta2 < 0, 0)).rolling(14).mean()
            with np.errstate(divide='ignore', invalid='ignore'):
                rsi_series2 = 100 - (100 / (1 + gain2 / loss2))
            rsi_min = rsi_series2.rolling(14).min()
            rsi_max = rsi_series2.rolling(14).max()
            raw_k = ((rsi_series2 - rsi_min) / (rsi_max - rsi_min).replace(0, np.nan)) * 100
            k_smooth = raw_k.rolling(3).mean()
            d_smooth = k_smooth.rolling(3).mean()
            k_val = k_smooth.iloc[-1]
            d_val = d_smooth.iloc[-1]
            stoch_k = float(k_val) if not np.isnan(k_val) else 50.0
            stoch_d = float(d_val) if not np.isnan(d_val) else 50.0

        return {
            "ema21": ema21, "ema50": ema50, "rsi": rsi, "atr_ratio": atr_ratio, "rvol": rvol,
            "vwap": vwap, "poc": poc, "macd": macd_val, "macd_signal": macd_signal, "macd_hist": macd_hist,
            "bb_upper": bb_upper, "bb_lower": bb_lower, "bb_width": bb_width,
            "stoch_k": stoch_k, "stoch_d": stoch_d
        }

    async def monitor_market(self, market_type: str) -> None:
        """Subscribes to Binance streams for a specific market type (spot or futures)."""
        while True:
            relevant_symbols = [s["symbol"] for s in self.monitored_symbols if s.get("type", "futures") == market_type]
            
            if not relevant_symbols:
                await asyncio.sleep(5)
                continue

            # Initialize state for new symbols
            for s_obj in [s for s in self.monitored_symbols if s.get("type", "futures") == market_type]:
                await self.init_symbol_state(s_obj)

            streams = []
            for s in relevant_symbols:
                sym = s.lower()
                streams.extend([f"{sym}@aggTrade"])
                if market_type == "futures":
                    streams.extend([
                        f"{sym}@forceOrder",
                        f"{sym}@openInterest@500ms",
                        f"{sym}@markPrice"
                    ])
                for tf in ALL_TIMEFRAMES:
                    streams.append(f"{sym}@kline_{tf}")
            
            ws_base = BINANCE_FUTURES_WS if market_type == "futures" else BINANCE_SPOT_WS
            ws_url = f"{ws_base}stream?streams={'/'.join(streams)}"
        
            try:
                async with websockets.connect(ws_url) as ws:
                    logger.info(f"Connected to Binance {market_type.upper()} Stream: {len(streams)} feeds")
                    while True:
                        current_relevant = [s["symbol"] for s in self.monitored_symbols if s.get("type", "futures") == market_type]
                        if current_relevant != relevant_symbols:
                            logger.info(f"{market_type.upper()} Symbols changed. Reconnecting...")
                            break
                            
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            data = json.loads(msg)
                            # Handle stream format where result is in 'data'
                            payload = data.get("data", data)
                            await self.handle_message(payload, market_type)
                        except asyncio.TimeoutError:
                            continue
                        except Exception as e:
                            logger.error(f"Error handling {market_type} message: {e}")
            except Exception as e:
                logger.error(f"{market_type.upper()} WS Connection lost: {e}. Retrying in 5s...")
                await asyncio.sleep(5)

    def get_thresholds(self, symbol: str) -> Dict[str, Any]:
        """Safely retrieves thresholds for a symbol or global defaults."""
        all_thresholds = self.config.get("thresholds", {})
        if not isinstance(all_thresholds, dict):
            all_thresholds = {}
        
        symbol_thresholds = all_thresholds.get(symbol)
        if not isinstance(symbol_thresholds, dict):
            symbol_thresholds = all_thresholds.get("global", {})
            
        return cast(Dict[str, Any], symbol_thresholds)

    async def handle_message(self, data: Dict[str, Any], market_type: str = "futures") -> None:
        """Main dispatcher for incoming market data."""
        stream = data.get("e")
        symbol = data.get("s")
        if not symbol: return

        symbol_state = self.state.get(symbol)
        if not symbol_state: return

        # 1. Whale Trades (Both Spot and Futures)
        if stream == "aggTrade":
            price = float(data['p'])
            amount = price * float(data['q'])
            symbol_state["last_price"] = price 
            
            thresholds = self.get_thresholds(symbol)
            min_whale = float(thresholds.get("whaleMinAmount", 500000))
            
            if amount >= min_whale:
                side = "🔴 SELL" if data['m'] else "🟢 BUY"
                delta_change = -amount if data['m'] else amount
                old_delta = float(symbol_state.get("whale_delta", 0.0))
                symbol_state["whale_delta"] = old_delta + delta_change
                
                momentum_threshold = float(thresholds.get("whaleMomentumDelta", 5000000))
                if abs(symbol_state["whale_delta"] - (old_delta // momentum_threshold * momentum_threshold)) >= momentum_threshold:
                    await self.send_alert(
                        f"[{symbol}] 🐳🚀 Whale Momentum Shift",
                        f"<b>Net Flow:</b> ${symbol_state['whale_delta']/1e6:+.2f}M\n<b>Dynamics:</b> {'Massive Accumulation' if delta_change > 0 else 'Massive Distribution'}",
                        "whale", symbol, "info", 900,
                        reason="whale_momentum_delta_cross",
                        current_value=symbol_state["whale_delta"],
                        threshold_value=momentum_threshold,
                        comparison="abs_delta>=",
                        metadata={"delta_change": delta_change},
                        market_type=market_type
                    )

                await self.send_alert(
                    f"[{symbol}] 🐳 Whale Trade",
                    f"<b>Direction:</b> {side}\n<b>Size:</b> ${amount/1e6:.2f}M\n<b>Price:</b> ${price:,.2f}",
                    "whale", symbol, "info", 60,
                    reason="whale_trade_amount_threshold_cross",
                    current_value=amount,
                    threshold_value=min_whale,
                    comparison=">=",
                    metadata={"side": "sell" if data['m'] else "buy"},
                    market_type=market_type
                )
            
            # Volume Profile
            profile = symbol_state.setdefault("volume_profile", {})
            bucket_size = 10.0 if price > 1000 else (0.1 if price > 10 else 0.001)
            bucket = float(round(price / bucket_size) * bucket_size)
            profile[bucket] = float(profile.get(bucket, 0.0)) + amount
            
            if len(profile) > 100:
                sorted_prices = sorted(profile.keys())
                total_vol = sum(profile.values())
                target = total_vol * 0.7
                poc = float(max(profile, key=profile.get))
                poc_idx = sorted_prices.index(poc)
                
                acc_vol = profile[poc]
                up = poc_idx + 1
                down = poc_idx - 1
                while acc_vol < target and (up < len(sorted_prices) or down >= 0):
                    u_v = float(profile[sorted_prices[up]]) if up < len(sorted_prices) else -1.0
                    d_v = float(profile[sorted_prices[down]]) if down >= 0 else -1.0
                    if u_v > d_v: acc_vol += u_v; up += 1
                    else: acc_vol += d_v; down -= 1
                
                vah = float(sorted_prices[min(up, len(sorted_prices)-1)])
                val = float(sorted_prices[max(down, 0)])
                
                old_vah = float(symbol_state.get("last_vah", 0.0))
                old_val = float(symbol_state.get("last_val", 0.0))
                if old_vah > 0:
                    if price > vah and float(symbol_state["last_price"]) <= vah:
                        await self.send_alert(f"[{symbol}] 📈 VA Breakout (High)", f"Price ${price:,.2f} > VAH ${vah:,.2f}", "level_testing", symbol, cooldown=3600, market_type=market_type)
                    elif price < val and float(symbol_state["last_price"]) >= val:
                        await self.send_alert(f"[{symbol}] 📉 VA Breakout (Low)", f"Price ${price:,.2f} < VAL ${val:,.2f}", "level_testing", symbol, cooldown=3600, market_type=market_type)
                
                symbol_state["last_vah"] = vah
                symbol_state["last_val"] = val

        # 2. Open Interest (Futures Only)
        elif stream == "openInterestUpdate":
            now = time.time()
            history = symbol_state.setdefault("oi_history", [])
            history.append({'t': now, 'v': float(data['o'])})
            symbol_state["oi_history"] = [h for h in history if now - h['t'] <= 3600]
            
            tf_config = self.config.get("timeframes", {})
            if isinstance(tf_config, dict):
                enabled_tfs = tf_config.get("oi_spike", ["5m"])
            else:
                enabled_tfs = ["5m"]
                
            seconds_map = {"1m": 60, "3m": 180, "5m": 300, "15m": 900}
            thresholds = self.get_thresholds(symbol)
            oi_threshold = float(thresholds.get("oiSpikePercentage", 1.5))
            
            for tf_str in enabled_tfs:
                if tf_str not in seconds_map: continue
                window = [h for h in symbol_state["oi_history"] if now - h['t'] <= seconds_map[tf_str]]
                if len(window) > 1:
                    oldest, newest = float(window[0]['v']), float(window[-1]['v'])
                    if oldest > 0:
                        change_pct = ((newest - oldest) / abs(oldest)) * 100
                        if self.should_fire_threshold(symbol, f"oi_spike:{tf_str}", abs(change_pct) > oi_threshold):
                            icon = "UP" if change_pct > 0 else "DOWN"
                            await self.send_alert(f"[{symbol}] {icon} OI SPIKE ({tf_str})", f"OI {'increased' if change_pct > 0 else 'dropped'} by {abs(change_pct):.2f}%", "oi_spike", symbol, tf=tf_str, market_type=market_type)

        # 3. Funding Rate (Futures Only)
        elif stream == "markPriceUpdate":
            rate = float(data['r'])
            old_rate = float(symbol_state.get("funding_rate", 0.0))
            symbol_state["funding_rate"] = rate
            extreme = float(self.get_thresholds(symbol).get("fundingExtremeRate", 0.05)) / 100
            if abs(rate) >= extreme and abs(old_rate) < extreme:
                dir_label = "🟢 POSITIVE" if rate > 0 else "🔴 NEGATIVE"
                await self.send_alert(f"[{symbol}] 🚨 Funding Extreme", f"Direction: {dir_label}\nRate: {rate*100:.4f}%", "extreme_funding", symbol, "warning", 14400, market_type=market_type)

        # 4. Liquidations (Futures Only)
        elif stream == "forceOrder":
            o = data['o']
            amount = float(o['p']) * float(o['q'])
            thresh = float(self.get_thresholds(symbol).get("liquidationMinAmount", 1000000))
            if amount >= thresh:
                await self.send_alert(f"[{symbol}] 💥 Liquidation", f"Side: {o['S']}\nAmount: ${amount/1e6:.2f}M", "liquidation", symbol, "warning", 30, market_type=market_type)

        # 5. Klines
        elif stream == "kline":
            k = data['k']
            tf = k['i']
            if not k['x']: return
            
            klines_tf = symbol_state.setdefault("klines", {}).setdefault(tf, [])
            klines_tf.append([k['t'], k['o'], k['h'], k['l'], k['c'], k['v']])
            if len(klines_tf) > 100: klines_tf.pop(0)

            if len(klines_tf) >= 30:
                ind = self.calculate_indicators(symbol, tf)
                ema21 = ind["ema21"]
                ema50 = ind["ema50"]
                rsi = ind["rsi"]
                atr_ratio = ind["atr_ratio"]
                rvol = ind["rvol"]
                vwap = ind["vwap"]
                poc = ind["poc"]
                price = float(k['c'])
                thresholds = self.get_thresholds(symbol)

                # Volatility
                exp_ratio = float(thresholds.get("atrExpansionRatio", 1.3))
                vol_state = "Normal"
                if atr_ratio > exp_ratio * 1.25: vol_state = "Extreme"
                elif atr_ratio > exp_ratio: vol_state = "Expanding"
                elif atr_ratio < 0.75: vol_state = "Squeeze"

                _, next_vol, vol_changed = self.debounced_state_change(symbol, "volatility", tf, vol_state)
                if vol_changed:
                    await self.send_alert(f"[{symbol}] Volatility Shift ({tf})", f"State: {next_vol}\nATR Ratio: {atr_ratio:.2f}x", "atr_expand", symbol, tf=tf, market_type=market_type)

                # Regime
                sep = abs(ema21 - ema50) / ema50 * 100 if ema50 != 0 else 0.0
                sep_thresh = float(thresholds.get("emaSeparationPct", 0.15))
                strength = "Strong" if sep > sep_thresh else "Weak"
                new_regime = "Range"
                if price > ema21 > ema50: new_regime = f"Uptrend ({strength})"
                elif price < ema21 < ema50: new_regime = f"Downtrend ({strength})"

                _, next_regime, regime_changed = self.debounced_state_change(symbol, "regime", tf, new_regime)
                if regime_changed:
                    icon = "UP" if "Uptrend" in next_regime else ("DOWN" if "Downtrend" in next_regime else "RANGE")
                    await self.send_alert(f"[{symbol}] {icon} Regime Shift ({tf})", f"Bias: {next_regime}\nRSI: {rsi:.1f}", "ema_cross", symbol, tf=tf, market_type=market_type)

                # RSI
                rsi_ob, rsi_os = float(thresholds.get("rsiOverbought", 70)), float(thresholds.get("rsiOversold", 30))
                rsi_state = "Neutral"
                if rsi >= rsi_ob: rsi_state = "Overbought"
                elif rsi <= rsi_os: rsi_state = "Oversold"
                _, next_rsi, rsi_changed = self.debounced_state_change(symbol, "rsi_state", tf, rsi_state)
                if rsi_changed and next_rsi != "Neutral":
                    await self.send_alert(f"[{symbol}] RSI Extreme ({tf})", f"State: {next_rsi}\nRSI: {rsi:.1f}", "rsi_extreme", symbol, tf=tf, market_type=market_type)

                # RVOL
                rvol_mult = float(thresholds.get("rvolMultiplier", 3.0))
                if self.should_fire_threshold(symbol, f"rvol_spike:{tf}", rvol >= rvol_mult):
                    await self.send_alert(f"[{symbol}] RVOL Spike ({tf})", f"RVOL: {rvol:.1f}x", "rvol_spike", symbol, tf=tf, market_type=market_type)

                # MACD Crossover
                macd_hist = ind.get("macd_hist")
                macd_val = ind.get("macd")
                if macd_hist is not None and macd_val is not None and macd_val != 0:
                    is_fresh_cross = abs(macd_hist) < abs(macd_val) * 0.1
                    macd_bias = "Bull" if macd_hist > 0 else "Bear"
                    _, next_macd, macd_changed = self.debounced_state_change(symbol, "macd_cross", tf, macd_bias)
                    if macd_changed and is_fresh_cross:
                        macd_icon = "UP" if macd_bias == "Bull" else "DOWN"
                        await self.send_alert(
                            f"[{symbol}] {macd_icon} MACD Cross ({tf})",
                            f"Direction: {macd_bias}ish\nHistogram: {macd_hist:.4f}\nMACD: {macd_val:.4f}",
                            "macd_cross", symbol, tf=tf, market_type=market_type
                        )

                # Bollinger Band Squeeze / Breakout
                bb_width = ind.get("bb_width")
                bb_upper = ind.get("bb_upper")
                bb_lower = ind.get("bb_lower")
                if bb_width is not None:
                    if bb_width < 2.0:
                        bb_state = "Squeeze"
                    elif bb_upper is not None and price > bb_upper:
                        bb_state = "Breakout_Up"
                    elif bb_lower is not None and price < bb_lower:
                        bb_state = "Breakout_Down"
                    else:
                        bb_state = "Normal"
                    _, next_bb, bb_changed = self.debounced_state_change(symbol, "bb_state", tf, bb_state)
                    if bb_changed and next_bb != "Normal":
                        if next_bb == "Squeeze":
                            await self.send_alert(
                                f"[{symbol}] BB Squeeze ({tf})",
                                f"BB Width: {bb_width:.2f}% — Breakout risk rising",
                                "bb_squeeze", symbol, tf=tf, market_type=market_type
                            )
                        elif next_bb == "Breakout_Up":
                            await self.send_alert(
                                f"[{symbol}] UP BB Breakout ({tf})",
                                f"Price broke above upper band\nBB Width: {bb_width:.2f}%\nUpper: {bb_upper:.4f}",
                                "bb_breakout", symbol, tf=tf, market_type=market_type
                            )
                        elif next_bb == "Breakout_Down":
                            await self.send_alert(
                                f"[{symbol}] DOWN BB Breakout ({tf})",
                                f"Price broke below lower band\nBB Width: {bb_width:.2f}%\nLower: {bb_lower:.4f}",
                                "bb_breakout", symbol, tf=tf, market_type=market_type
                            )

                # StochRSI Extreme
                stoch_k = ind.get("stoch_k")
                stoch_d = ind.get("stoch_d")
                if stoch_k is not None and stoch_d is not None:
                    if stoch_k > 85 and stoch_k > stoch_d:
                        stoch_state = "Overbought"
                    elif stoch_k < 15 and stoch_k < stoch_d:
                        stoch_state = "Oversold"
                    else:
                        stoch_state = "Neutral"
                    _, next_stoch, stoch_changed = self.debounced_state_change(symbol, "stoch_state", tf, stoch_state)
                    if stoch_changed and next_stoch != "Neutral":
                        stoch_icon = "DOWN" if next_stoch == "Overbought" else "UP"
                        await self.send_alert(
                            f"[{symbol}] {stoch_icon} StochRSI {next_stoch} ({tf})",
                            f"K: {stoch_k:.1f}  D: {stoch_d:.1f}",
                            "stoch_extreme", symbol, tf=tf, market_type=market_type
                        )

                # OI / Price Divergence
                oi_history = symbol_state.get("oi_history", [])
                if len(oi_history) >= 6:
                    recent_oi = [float(h['v']) for h in oi_history[-6:]]
                    oi_trend_up = recent_oi[-1] > recent_oi[0]
                    price_trend_up = price > ema21
                    if price_trend_up and not oi_trend_up:
                        div_state = "Bearish_Div"
                    elif not price_trend_up and not oi_trend_up:
                        div_state = "Bullish_Div"
                    else:
                        div_state = "None"
                    _, next_div, div_changed = self.debounced_state_change(symbol, "oi_div", tf, div_state)
                    if div_changed and next_div != "None":
                        label = "Bearish" if next_div == "Bearish_Div" else "Bullish"
                        desc = "Price rising but OI falling — weak move" if label == "Bearish" else "Price falling but OI falling — potential squeeze"
                        await self.send_alert(
                            f"[{symbol}] OI/Price {label} Divergence ({tf})",
                            desc,
                            "oi_divergence", symbol, tf=tf, market_type=market_type
                        )

    async def run(self) -> None:
        """Starts the engine tasks."""
        await self.get_bot_config()
        init_tasks = [self.init_symbol_state(s) for s in self.monitored_symbols]
        if init_tasks: await asyncio.gather(*init_tasks)
        await asyncio.gather(self.monitor_market("spot"), self.monitor_market("futures"), self.periodic_config_sync())

    async def periodic_config_sync(self) -> None:
        """Keeps in-memory config fresh every 10s or on flag."""
        while True:
            await self.get_bot_config()
            if os.path.exists("reload.flag"):
                try: os.remove("reload.flag")
                except: pass
                logger.info("Reload flag detected, syncing config.")
            await asyncio.sleep(10)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    engine = MarketEngine()
    asyncio.run(engine.run())
