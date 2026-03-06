import os
import sys
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import alert_metadata  # noqa: E402


class AlertMetadataTests(unittest.TestCase):
    def test_build_alert_metadata_populates_reason_context(self):
        metadata = alert_metadata.build_alert_metadata(
            reason="oi_change_threshold_cross",
            current_value=2.4,
            threshold_value=1.5,
            comparison=">",
            timeframe="5m",
            session="US",
        )
        self.assertEqual(metadata["reason"], "oi_change_threshold_cross")
        self.assertEqual(metadata["current_value"], 2.4)
        self.assertEqual(metadata["threshold_value"], 1.5)
        self.assertEqual(metadata["comparison"], ">")
        self.assertEqual(metadata["timeframe"], "5m")
        self.assertEqual(metadata["session"], "US")

    def test_build_alert_metadata_defaults_when_missing(self):
        metadata = alert_metadata.build_alert_metadata(session="London")
        self.assertEqual(metadata["reason"], "rule_triggered")
        self.assertIsNone(metadata["current_value"])
        self.assertIsNone(metadata["threshold_value"])
        self.assertIsNone(metadata["comparison"])
        self.assertIsNone(metadata["timeframe"])
        self.assertEqual(metadata["session"], "London")


if __name__ == "__main__":
    unittest.main()

