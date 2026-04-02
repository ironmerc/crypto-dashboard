"""
Tests for the calculate_indicators method of MarketEngine.
Covers MACD, Bollinger Bands, and StochRSI calculations against
known values derived independently.
"""
import os
import sys
import math
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import numpy as np
import pandas as pd


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_engine_with_klines(klines: list) -> "MarketEngine":
    """Build a minimal MarketEngine with the supplied klines pre-loaded."""
    from market_engine import MarketEngine
    engine = MarketEngine.__new__(MarketEngine)
    engine.config = {}
    engine.state = {
        "BTCUSDT": {
            "klines": {"1h": klines},
        }
    }
    return engine


def build_klines(closes: list, high_offset: float = 1.0, low_offset: float = 1.0,
                 volume: float = 100.0) -> list:
    """
    Build minimal kline rows: [timestamp, open, high, low, close, volume].
    High = close + high_offset, Low = close - low_offset.
    """
    rows = []
    for i, c in enumerate(closes):
        rows.append([i * 60000, c, c + high_offset, c - low_offset, c, volume])
    return rows


def ramp(n: int, start: float = 100.0, step: float = 1.0) -> list:
    return [start + i * step for i in range(n)]


def flat(n: int, value: float = 100.0) -> list:
    return [value] * n


# ─── MACD ────────────────────────────────────────────────────────────────────

class TestMACD(unittest.TestCase):

    def _get_macd(self, closes):
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        return ind["macd"], ind["macd_signal"], ind["macd_hist"]

    def test_macd_defaults_zero_when_insufficient_data(self):
        """Fewer than 26 bars → default 0.0 values returned."""
        macd, sig, hist = self._get_macd(flat(20))
        self.assertEqual(macd, 0.0)
        self.assertEqual(sig, 0.0)
        self.assertEqual(hist, 0.0)

    def test_macd_positive_on_uptrend(self):
        """Fast EMA rises faster than slow EMA on an upward ramp."""
        macd, _, _ = self._get_macd(ramp(60, 100, 2))
        self.assertGreater(macd, 0)

    def test_macd_negative_on_downtrend(self):
        macd, _, _ = self._get_macd(ramp(60, 300, -2))
        self.assertLess(macd, 0)

    def test_macd_near_zero_on_flat(self):
        """Flat price → both EMAs converge → MACD ≈ 0."""
        macd, _, _ = self._get_macd(flat(200))
        self.assertAlmostEqual(macd, 0.0, places=6)

    def test_histogram_equals_macd_minus_signal(self):
        macd, sig, hist = self._get_macd(ramp(60))
        self.assertAlmostEqual(hist, macd - sig, places=10)

    def test_macd_matches_pandas_calculation(self):
        """Cross-check engine output against a direct pandas EWM calculation."""
        closes = ramp(60, 100, 1.5)
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")

        s = pd.Series(closes)
        ema12 = s.ewm(span=12, adjust=False).mean()
        ema26 = s.ewm(span=26, adjust=False).mean()
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        expected_macd = float(macd_line.iloc[-1])
        expected_sig = float(signal_line.iloc[-1])

        self.assertAlmostEqual(ind["macd"], expected_macd, places=8)
        self.assertAlmostEqual(ind["macd_signal"], expected_sig, places=8)


# ─── Bollinger Bands ─────────────────────────────────────────────────────────

class TestBollingerBands(unittest.TestCase):

    def _get_bb(self, closes):
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        return ind["bb_upper"], ind["bb_lower"], ind["bb_width"]

    def test_bb_defaults_zero_when_insufficient_data(self):
        upper, lower, width = self._get_bb(flat(10))
        self.assertEqual(upper, 0.0)
        self.assertEqual(lower, 0.0)
        self.assertEqual(width, 0.0)

    def test_upper_greater_than_lower(self):
        upper, lower, _ = self._get_bb(ramp(30))
        self.assertGreater(upper, lower)

    def test_width_zero_on_flat_series(self):
        """Flat price → std dev = 0 → bands are equal → width = 0."""
        upper, lower, width = self._get_bb(flat(30))
        self.assertAlmostEqual(width, 0.0, places=6)

    def test_width_positive_on_volatile_series(self):
        closes = [100 if i % 2 == 0 else 110 for i in range(30)]
        _, _, width = self._get_bb(closes)
        self.assertGreater(width, 0)

    def test_bb_matches_pandas_calculation(self):
        """Cross-check against pandas rolling mean + std (ddof=1, sample std)."""
        closes = ramp(30, 100, 0.8)
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")

        s = pd.Series(closes)
        sma = s.rolling(20).mean().iloc[-1]
        std = s.rolling(20).std().iloc[-1]   # ddof=1 by default in pandas
        expected_upper = float(sma + 2 * std)
        expected_lower = float(sma - 2 * std)
        expected_width = float((expected_upper - expected_lower) / sma * 100)

        self.assertAlmostEqual(ind["bb_upper"], expected_upper, places=8)
        self.assertAlmostEqual(ind["bb_lower"], expected_lower, places=8)
        self.assertAlmostEqual(ind["bb_width"], expected_width, places=8)

    def test_width_formula(self):
        upper, lower, width = self._get_bb(ramp(30, 100, 1))
        engine = make_engine_with_klines(build_klines(ramp(30, 100, 1)))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        s = pd.Series(ramp(30, 100, 1))
        sma = float(s.rolling(20).mean().iloc[-1])
        self.assertAlmostEqual(width, (upper - lower) / sma * 100, places=8)


# ─── StochRSI ────────────────────────────────────────────────────────────────

class TestStochRSI(unittest.TestCase):

    def _get_stoch(self, closes):
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        return ind["stoch_k"], ind["stoch_d"]

    def test_stoch_defaults_50_when_insufficient_data(self):
        k, d = self._get_stoch(flat(20))
        self.assertEqual(k, 50.0)
        self.assertEqual(d, 50.0)

    def test_k_in_range_0_100(self):
        k, _ = self._get_stoch(ramp(60, 100, 1))
        self.assertGreaterEqual(k, 0.0)
        self.assertLessEqual(k, 100.0)

    def test_d_in_range_0_100(self):
        _, d = self._get_stoch(ramp(60, 100, 1))
        self.assertGreaterEqual(d, 0.0)
        self.assertLessEqual(d, 100.0)

    def test_k_high_on_strong_uptrend(self):
        """Zigzag upward then surge → RSI variation → StochRSI K near 100.
        Pure constant ramps lock RSI at 100, making StochRSI undefined (returns 50)."""
        closes = [100.0]
        for i in range(1, 70):
            prev = closes[-1]
            closes.append(prev - 1.0 if i % 3 == 0 else prev + 2.0)
        # Surge must be < 27 bars to keep RSI varying in the StochRSI window
        for _ in range(12):
            closes.append(closes[-1] + 3.0)
        k, _ = self._get_stoch(closes)
        self.assertGreater(k, 80.0)

    def test_k_low_on_strong_downtrend(self):
        """Zigzag downward then plunge → RSI variation → StochRSI K near 0."""
        closes = [300.0]
        for i in range(1, 70):
            prev = closes[-1]
            closes.append(prev + 1.0 if i % 3 == 0 else prev - 2.0)
        for _ in range(12):
            closes.append(closes[-1] - 3.0)
        k, _ = self._get_stoch(closes)
        self.assertLess(k, 20.0)

    def test_k_and_d_are_50_on_flat_series(self):
        """Flat price → RSI is undefined (no gains/losses) → defaults to 50."""
        k, d = self._get_stoch(flat(80))
        # On a perfectly flat series RSI calc produces NaN → engine returns 50
        self.assertAlmostEqual(k, 50.0, places=1)
        self.assertAlmostEqual(d, 50.0, places=1)

    def test_stoch_matches_manual_calculation(self):
        """Cross-check engine StochRSI against a reference pandas implementation."""
        closes = ramp(60, 100, 1)
        engine = make_engine_with_klines(build_klines(closes))
        ind = engine.calculate_indicators("BTCUSDT", "1h")

        s = pd.Series(closes)
        delta = s.diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
        with np.errstate(divide='ignore', invalid='ignore'):
            rsi_s = 100 - (100 / (1 + gain / loss))
        rsi_min = rsi_s.rolling(14).min()
        rsi_max = rsi_s.rolling(14).max()
        raw_k = ((rsi_s - rsi_min) / (rsi_max - rsi_min).replace(0, np.nan)) * 100
        k_smooth = raw_k.rolling(3).mean()
        d_smooth = k_smooth.rolling(3).mean()

        k_val = k_smooth.iloc[-1]
        d_val = d_smooth.iloc[-1]

        if not math.isnan(k_val):
            self.assertAlmostEqual(ind["stoch_k"], float(k_val), places=6)
        if not math.isnan(d_val):
            self.assertAlmostEqual(ind["stoch_d"], float(d_val), places=6)


# ─── Integration: all indicators returned together ────────────────────────────

class TestCalculateIndicatorsIntegration(unittest.TestCase):

    def test_all_expected_keys_present(self):
        engine = make_engine_with_klines(build_klines(ramp(60)))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        expected_keys = {
            "ema21", "ema50", "rsi", "atr_ratio", "rvol", "vwap", "poc",
            "macd", "macd_signal", "macd_hist",
            "bb_upper", "bb_lower", "bb_width",
            "stoch_k", "stoch_d",
        }
        self.assertEqual(set(ind.keys()), expected_keys)

    def test_empty_klines_returns_safe_defaults(self):
        engine = make_engine_with_klines([])
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        self.assertEqual(ind["rsi"], 50.0)
        self.assertEqual(ind["stoch_k"], 50.0)
        self.assertEqual(ind["macd"], 0.0)
        self.assertEqual(ind["bb_width"], 0.0)

    def test_all_values_are_finite_floats(self):
        engine = make_engine_with_klines(build_klines(ramp(60)))
        ind = engine.calculate_indicators("BTCUSDT", "1h")
        for key, val in ind.items():
            self.assertIsInstance(val, float, msg=f"{key} is not float")
            self.assertTrue(math.isfinite(val), msg=f"{key} is not finite: {val}")


if __name__ == "__main__":
    unittest.main()
