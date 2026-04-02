import os
import sys
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import config_utils  # noqa: E402


class ConfigUtilsTests(unittest.TestCase):
    def test_normalizes_flat_threshold_keys_into_global(self):
        original = {
            "thresholds": {
                "global": {"whaleMinAmount": 1_000_000},
                "whaleMinAmount": 500_000,
                "rsiOverbought": 70,
                "DOGEUSDT": {"whaleMinAmount": 750_000},
            }
        }

        normalized, changed, notes = config_utils.normalize_config_shape(original)

        self.assertTrue(changed)
        self.assertTrue(any("thresholds shape" in n for n in notes))
        self.assertEqual(normalized["thresholds"]["global"]["whaleMinAmount"], 1_000_000)
        self.assertEqual(normalized["thresholds"]["global"]["rsiOverbought"], 70)
        self.assertIn("DOGEUSDT", normalized["thresholds"])
        self.assertNotIn("whaleMinAmount", normalized["thresholds"])
        self.assertNotIn("rsiOverbought", normalized["thresholds"])

    def test_uses_flat_values_when_global_missing(self):
        original = {
            "thresholds": {
                "oiSpikePercentage": 2.5,
                "fundingExtremeRate": 0.1,
            }
        }

        normalized, changed, _ = config_utils.normalize_config_shape(original)

        self.assertTrue(changed)
        self.assertEqual(normalized["thresholds"]["global"]["oiSpikePercentage"], 2.5)
        self.assertEqual(normalized["thresholds"]["global"]["fundingExtremeRate"], 0.1)

    def test_keeps_valid_shape_unchanged(self):
        original = {
            "thresholds": {
                "global": dict(config_utils.DEFAULT_THRESHOLDS),
                "BTCUSDT": {
                    **config_utils.DEFAULT_THRESHOLDS,
                    "whaleMinAmount": 700_000,
                },
            },
            "timeframes": config_utils.default_timeframes_for_sensitive_categories(),
        }

        normalized, changed, notes = config_utils.normalize_config_shape(original)

        self.assertFalse(changed)
        self.assertEqual(notes, [])
        self.assertEqual(normalized, original)

    def test_prunes_unsupported_timeframes(self):
        original = {
            "monitoredTimeframes": ["1m", "30m", "4h", "12h", "1w", "1M", "1m"],
            "timeframes": {
                "atr_expand": ["5m", "30m", "1h", "2h", "1w"],
                "oi_spike": ["15m", "4h", "1M"],
            },
        }

        normalized, changed, notes = config_utils.normalize_config_shape(original)

        self.assertTrue(changed)
        self.assertTrue(any("monitoredTimeframes" in n for n in notes))
        self.assertTrue(any("timeframe configuration" in n for n in notes))
        self.assertEqual(normalized["monitoredTimeframes"], ["1m", "4h", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["atr_expand"], ["5m", "1h", "1w"])
        self.assertEqual(normalized["timeframes"]["oi_spike"], ["15m", "4h", "1M"])

    def test_defaults_sensitive_categories_to_high_timeframes(self):
        original = {
            "timeframes": {
                "atr_expand": ["1h", "4h"],
            }
        }

        normalized, changed, _ = config_utils.normalize_config_shape(original)

        self.assertTrue(changed)
        self.assertEqual(normalized["timeframes"]["atr_expand"], ["1h", "4h"])
        self.assertEqual(normalized["timeframes"]["ema_cross"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["rsi_extreme"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["macd_cross"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["bb_squeeze"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["bb_breakout"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["stoch_extreme"], ["1h", "4h", "1d", "1w", "1M"])
        self.assertEqual(normalized["timeframes"]["oi_divergence"], ["1h", "4h", "1d", "1w", "1M"])

    def test_normalizes_new_threshold_keys_into_global(self):
        original = {
            "thresholds": {
                "macdFreshnessRatio": 0.15,
                "bbSqueezeWidthPct": 1.8,
                "stochOverbought": 88,
                "stochOversold": 12,
                "oiDivergenceLookbackBars": 8,
            }
        }

        normalized, changed, _ = config_utils.normalize_config_shape(original)

        self.assertTrue(changed)
        self.assertEqual(normalized["thresholds"]["global"]["macdFreshnessRatio"], 0.15)
        self.assertEqual(normalized["thresholds"]["global"]["bbSqueezeWidthPct"], 1.8)
        self.assertEqual(normalized["thresholds"]["global"]["stochOverbought"], 88)
        self.assertEqual(normalized["thresholds"]["global"]["stochOversold"], 12)
        self.assertEqual(normalized["thresholds"]["global"]["oiDivergenceLookbackBars"], 8)


if __name__ == "__main__":
    unittest.main()
