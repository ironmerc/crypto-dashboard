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
                "global": {"whaleMinAmount": 500_000},
                "BTCUSDT": {"whaleMinAmount": 700_000},
            }
        }

        normalized, changed, notes = config_utils.normalize_config_shape(original)

        self.assertFalse(changed)
        self.assertEqual(notes, [])
        self.assertEqual(normalized, original)


if __name__ == "__main__":
    unittest.main()

