import os
import sys
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import schema_validation  # noqa: E402


class SchemaValidationTests(unittest.TestCase):
    def test_unknown_key_warns(self):
        schema = schema_validation.load_schema("telegram-config.schema.json")
        payload = {
            "globalEnabled": True,
            "activeSessions": ["US"],
            "monitoredSymbols": ["BTCUSDT"],
            "alertOnStateChange": True,
            "quietHours": {"enabled": False, "start": "22:00", "end": "06:00"},
            "categories": {},
            "cooldowns": {},
            "thresholds": {},
            "timeframes": {},
            "unknownField": 1,
        }
        warnings = schema_validation.validate_by_schema_warn_only(payload, schema, partial=False)
        self.assertTrue(any("$.unknownField" in warning for warning in warnings))

    def test_partial_payload_skips_missing_required(self):
        schema = schema_validation.load_schema("telegram-config.schema.json")
        warnings = schema_validation.validate_by_schema_warn_only(
            {"quietHours": {"enabled": True}},
            schema,
            partial=True,
        )
        self.assertFalse(any("missing required" in warning for warning in warnings))

    def test_alert_event_metadata_shape_is_supported(self):
        schema = schema_validation.load_schema("alert-event.schema.json")
        payload = {
            "message": "x",
            "type": "oi_spike",
            "symbol": "BTCUSDT",
            "metadata": {
                "reason": "oi_change_threshold_cross",
                "current_value": 2.1,
                "threshold_value": 1.5,
                "comparison": ">",
                "timeframe": "5m",
                "session": "US",
            },
        }
        warnings = schema_validation.validate_by_schema_warn_only(payload, schema, partial=False)
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()

