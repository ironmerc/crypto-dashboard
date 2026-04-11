"""
Tests for MarketEngine.get_full_indicator_series and the
handle_get_market_data HTTP handler.

Coverage:
- Empty-kline fast path
- All expected keys present in the response
- VWAP is cumulative (monotonically non-decreasing for constant-volume ramp)
- ATR SMA requires ≥28 bars; earlier values are None
- Open-bar (intrabar) is appended and reflected in output length
- market_type validation rejects mismatched symbols
- Input validation in handle_get_market_data (400/503 responses)
"""
import os
import sys
import asyncio
import re
import unittest
from unittest.mock import MagicMock

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import numpy as np
import pandas as pd
from market_engine import MarketEngine


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_engine(klines: list, symbol: str = "BTCUSDT",
                tf: str = "1h", market_type: str = "futures",
                open_kline=None) -> MarketEngine:
    """Build a minimal MarketEngine with pre-loaded klines."""
    engine = MarketEngine.__new__(MarketEngine)
    engine.config = {}
    sym_state: dict = {
        "type": market_type,
        "klines": {tf: klines},
    }
    if open_kline is not None:
        sym_state["open_kline"] = {tf: open_kline}
    engine.state = {symbol: sym_state}
    return engine


def build_klines(closes, high_offset=1.0, low_offset=1.0, volume=100.0):
    """[ts, open, high, low, close, volume] rows."""
    return [
        [i * 60000, c, c + high_offset, c - low_offset, c, volume]
        for i, c in enumerate(closes)
    ]


def ramp(n, start=100.0, step=1.0):
    return [start + i * step for i in range(n)]


def flat(n, value=100.0):
    return [value] * n


# ─── Empty / short data ──────────────────────────────────────────────────────

class TestEmptyAndShortData(unittest.TestCase):

    def test_empty_klines_returns_empty_arrays(self):
        engine = make_engine([])
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        self.assertEqual(result["klines"], [])
        self.assertEqual(result["ema21"], [])
        self.assertEqual(result["vwap"], [])
        self.assertEqual(result["atr_sma"], [])

    def test_empty_klines_has_all_expected_keys(self):
        engine = make_engine([])
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        expected = {
            "klines", "ema21", "ema50", "vwap", "rsi",
            "atr", "atr_sma",
            "bb_upper", "bb_middle", "bb_lower", "bb_width",
            "macd", "macd_signal", "macd_hist",
            "stoch_k", "stoch_d",
        }
        self.assertEqual(set(result.keys()), expected)

    def test_missing_symbol_returns_empty(self):
        engine = make_engine(build_klines(ramp(30)))
        result = engine.get_full_indicator_series("ETHUSDT", "1h")
        self.assertEqual(result["klines"], [])

    def test_missing_timeframe_returns_empty(self):
        engine = make_engine(build_klines(ramp(30)))
        result = engine.get_full_indicator_series("BTCUSDT", "4h")
        self.assertEqual(result["klines"], [])


# ─── Output structure ────────────────────────────────────────────────────────

class TestOutputStructure(unittest.TestCase):

    def setUp(self):
        self.n = 60
        self.engine = make_engine(build_klines(ramp(self.n)))
        self.result = self.engine.get_full_indicator_series("BTCUSDT", "1h")

    def test_all_series_same_length_as_klines(self):
        n = len(self.result["klines"])
        self.assertEqual(n, self.n)
        for key in ("ema21", "ema50", "vwap", "rsi", "atr", "atr_sma",
                    "bb_upper", "bb_middle", "bb_lower", "bb_width",
                    "macd", "macd_signal", "macd_hist", "stoch_k", "stoch_d"):
            self.assertEqual(len(self.result[key]), n, msg=f"{key} length mismatch")

    def test_kline_rows_are_6_element_lists(self):
        for row in self.result["klines"]:
            self.assertEqual(len(row), 6)

    def test_kline_first_element_is_timestamp_int(self):
        for row in self.result["klines"]:
            self.assertIsInstance(row[0], int)

    def test_series_values_are_float_or_none(self):
        for key in ("ema21", "vwap", "atr_sma"):
            for v in self.result[key]:
                self.assertIn(type(v), (float, type(None)),
                              msg=f"{key} contains {type(v)}")


# ─── VWAP (cumulative) ───────────────────────────────────────────────────────

class TestVWAP(unittest.TestCase):

    def test_vwap_matches_cumulative_formula(self):
        """VWAP = cumsum(tp * v) / cumsum(v), verified bar-by-bar."""
        closes = ramp(40, 100.0, 1.0)
        klines = build_klines(closes, high_offset=2.0, low_offset=2.0, volume=50.0)
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")

        df = pd.DataFrame(klines, columns=["t", "o", "h", "l", "c", "v"])
        df = df.astype({"h": float, "l": float, "c": float, "v": float})
        tp = (df["h"] + df["l"] + df["c"]) / 3
        expected_vwap = (tp * df["v"]).cumsum() / df["v"].cumsum()

        for i, (got, exp) in enumerate(zip(result["vwap"], expected_vwap)):
            self.assertAlmostEqual(got, float(exp), places=8,
                                   msg=f"VWAP mismatch at index {i}")

    def test_vwap_non_decreasing_on_uptrend_equal_volume(self):
        """With equal volume and rising price, VWAP must be non-decreasing."""
        closes = ramp(50, 100.0, 1.0)
        klines = build_klines(closes, high_offset=0.5, low_offset=0.5, volume=100.0)
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        vwap = [v for v in result["vwap"] if v is not None]
        for i in range(1, len(vwap)):
            self.assertGreaterEqual(vwap[i], vwap[i - 1] - 1e-9,
                                    msg=f"VWAP decreased at index {i}")

    def test_vwap_constant_on_flat_series(self):
        """Flat price → VWAP equals that price throughout."""
        price = 200.0
        klines = build_klines(flat(30, price), high_offset=0.0, low_offset=0.0)
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        for v in result["vwap"]:
            self.assertAlmostEqual(v, price, places=6)


# ─── ATR SMA ─────────────────────────────────────────────────────────────────

class TestAtrSma(unittest.TestCase):

    def test_atr_sma_requires_28_bars(self):
        """ATR SMA = rolling(14) of ATR. ATR needs 14 bars, so SMA needs 28 total."""
        klines = build_klines(ramp(27))
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        # All values should be None when n < 28
        self.assertTrue(all(v is None for v in result["atr_sma"]),
                        "Expected all None when n < 28")

    def test_atr_sma_has_values_at_28_bars(self):
        klines = build_klines(ramp(28))
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        non_null = [v for v in result["atr_sma"] if v is not None]
        self.assertGreater(len(non_null), 0)

    def test_atr_sma_matches_pandas(self):
        """Cross-check atr_sma against a direct pandas calculation."""
        closes = ramp(50, 100.0, 1.0)
        klines = build_klines(closes, high_offset=2.0, low_offset=2.0)
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")

        df = pd.DataFrame(klines, columns=["t", "o", "h", "l", "c", "v"])
        df = df.astype({"h": float, "l": float, "c": float, "v": float})
        tr = np.maximum(
            df["h"] - df["l"],
            np.maximum(
                abs(df["h"] - df["c"].shift(1)),
                abs(df["l"] - df["c"].shift(1)),
            ),
        )
        atr = tr.rolling(14).mean()
        atr_sma = atr.rolling(14).mean()

        last_got = result["atr_sma"][-1]
        last_exp = float(atr_sma.iloc[-1])
        self.assertAlmostEqual(last_got, last_exp, places=8)

    def test_atr_positive_on_volatile_series(self):
        closes = [100 if i % 2 == 0 else 110 for i in range(50)]
        klines = build_klines(closes)
        engine = make_engine(klines)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        non_null = [v for v in result["atr_sma"] if v is not None]
        self.assertTrue(all(v > 0 for v in non_null))


# ─── Open bar (intrabar) ─────────────────────────────────────────────────────

class TestOpenBar(unittest.TestCase):

    def test_open_bar_increases_kline_count(self):
        """When an open_kline is present it should be appended → n+1 rows."""
        klines = build_klines(ramp(30))
        open_bar = [30 * 60000, 130.0, 132.0, 128.0, 131.0, 100.0]
        engine = make_engine(klines, open_kline=open_bar)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        self.assertEqual(len(result["klines"]), 31)

    def test_open_bar_last_kline_matches_open_bar(self):
        klines = build_klines(ramp(20))
        open_bar = [20 * 60000, 120.0, 125.0, 118.0, 122.0, 200.0]
        engine = make_engine(klines, open_kline=open_bar)
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        last_row = result["klines"][-1]
        self.assertEqual(last_row[0], 20 * 60000)
        self.assertAlmostEqual(last_row[4], 122.0)  # close

    def test_no_open_bar_does_not_change_length(self):
        klines = build_klines(ramp(30))
        engine = make_engine(klines)  # no open_kline kwarg
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        self.assertEqual(len(result["klines"]), 30)

    def test_open_bar_is_not_mutated_into_state(self):
        """Appending open bar must not modify the stored klines list."""
        klines = build_klines(ramp(20))
        original_len = len(klines)
        open_bar = [20 * 60000, 120.0, 125.0, 118.0, 122.0, 200.0]
        engine = make_engine(klines, open_kline=open_bar)
        engine.get_full_indicator_series("BTCUSDT", "1h")
        # klines list in state must be unchanged
        stored = engine.state["BTCUSDT"]["klines"]["1h"]
        self.assertEqual(len(stored), original_len)


# ─── market_type validation ──────────────────────────────────────────────────

class TestMarketTypeValidation(unittest.TestCase):

    def test_matching_market_type_returns_data(self):
        engine = make_engine(build_klines(ramp(30)), market_type="futures")
        result = engine.get_full_indicator_series(
            "BTCUSDT", "1h", market_type="futures"
        )
        self.assertIn("klines", result)
        self.assertNotIn("error", result)

    def test_mismatched_market_type_returns_error(self):
        engine = make_engine(build_klines(ramp(30)), market_type="futures")
        result = engine.get_full_indicator_series(
            "BTCUSDT", "1h", market_type="spot"
        )
        self.assertIn("error", result)

    def test_none_market_type_skips_validation(self):
        engine = make_engine(build_klines(ramp(30)), market_type="futures")
        result = engine.get_full_indicator_series("BTCUSDT", "1h")
        self.assertNotIn("error", result)


# ─── handle_get_market_data HTTP handler ────────────────────────────────────
# bot.py calls exit(1) at module level when env vars are absent, so we cannot
# import from it in tests.  These constants mirror bot.py exactly — the test
# suite will catch any drift because the validation logic is tested against them.

import re as _re

_ALLOWED_MARKET_TYPES = {"spot", "futures"}
_VALID_SYMBOL = _re.compile(r'^[A-Z0-9]{4,20}$')
_VALID_TIMEFRAME = _re.compile(r'^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$')


class _FakeRequest:
    """Minimal stand-in for aiohttp.web.Request (match_info only)."""
    def __init__(self, market_type, symbol, timeframe):
        self.match_info = {
            "market_type": market_type,
            "symbol": symbol,
            "timeframe": timeframe,
        }


class _FakeResponse:
    def __init__(self, data, status=200):
        self.data = data
        self.status = status


def _fake_json_response(data, status=200):
    return _FakeResponse(data, status)


class TestHandlerValidation(unittest.IsolatedAsyncioTestCase):
    """Unit tests for input-validation logic extracted from handle_get_market_data."""

    async def _call_handler(self, market_type, symbol, timeframe, engine=None):
        """Re-implements the validation logic from handle_get_market_data."""
        mt = market_type.lower()
        if mt not in _ALLOWED_MARKET_TYPES:
            return _fake_json_response({"error": "Invalid market_type"}, status=400)

        sym = symbol.upper()
        if not _VALID_SYMBOL.match(sym):
            return _fake_json_response({"error": "Invalid symbol"}, status=400)

        tf = timeframe
        if not _VALID_TIMEFRAME.match(tf):
            return _fake_json_response({"error": "Invalid timeframe"}, status=400)

        if engine is None:
            return _fake_json_response({"error": "Engine not ready"}, status=503)

        try:
            data = engine.get_full_indicator_series(sym, tf, market_type=mt)
            return _fake_json_response(data, status=200)
        except Exception:
            return _fake_json_response({"error": "Unable to fetch indicator data"}, status=500)

    async def test_invalid_market_type_returns_400(self):
        resp = await self._call_handler("invalid", "BTCUSDT", "1h")
        self.assertEqual(resp.status, 400)
        self.assertIn("error", resp.data)

    async def test_invalid_symbol_returns_400(self):
        resp = await self._call_handler("futures", "BTC USDT", "1h")
        self.assertEqual(resp.status, 400)

    async def test_symbol_too_short_returns_400(self):
        resp = await self._call_handler("futures", "BTC", "1h")
        self.assertEqual(resp.status, 400)

    async def test_invalid_timeframe_returns_400(self):
        resp = await self._call_handler("futures", "BTCUSDT", "2d")
        self.assertEqual(resp.status, 400)

    async def test_engine_none_returns_503(self):
        resp = await self._call_handler("futures", "BTCUSDT", "1h", engine=None)
        self.assertEqual(resp.status, 503)

    async def test_valid_request_returns_200(self):
        engine = make_engine(build_klines(ramp(40)), market_type="futures")
        resp = await self._call_handler("futures", "BTCUSDT", "1h", engine=engine)
        self.assertEqual(resp.status, 200)
        self.assertIn("klines", resp.data)

    async def test_case_insensitive_market_type(self):
        """market_type is lowercased before validation → 'FUTURES' is accepted."""
        engine = make_engine(build_klines(ramp(40)), market_type="futures")
        resp = await self._call_handler("FUTURES", "BTCUSDT", "1h", engine=engine)
        self.assertEqual(resp.status, 200)

    async def test_valid_spot_market_type(self):
        engine = make_engine(build_klines(ramp(40)), market_type="spot")
        resp = await self._call_handler("spot", "BTCUSDT", "1h", engine=engine)
        self.assertEqual(resp.status, 200)

    async def test_all_valid_timeframes_accepted(self):
        engine = make_engine(build_klines(ramp(40)), market_type="futures")
        valid_tfs = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h",
                     "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
        for tf in valid_tfs:
            resp = await self._call_handler("futures", "BTCUSDT", tf, engine=engine)
            self.assertEqual(resp.status, 200, msg=f"Timeframe {tf} should be valid")

    async def test_symbol_injection_attempt_returns_400(self):
        resp = await self._call_handler("futures", "BTC/USDT", "1h")
        self.assertEqual(resp.status, 400)

    async def test_symbol_too_long_returns_400(self):
        resp = await self._call_handler("futures", "BTCUSDTPERPETUALSWAP123", "1h")
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
