import os
import sys
import unittest
from datetime import datetime, timezone

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import alert_policy  # noqa: E402


class AlertPolicyTests(unittest.TestCase):
    def test_cooldown_key_is_scoped_by_type_symbol_and_tf(self):
        key = alert_policy.build_cooldown_key({
            "type": "oi_spike",
            "symbol": "BTCUSDT",
            "tf": "5m",
        })
        self.assertEqual(key, "oi_spike|BTCUSDT|5m")

    def test_global_toggle_blocks_alert(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "whale", "symbol": "BTCUSDT"},
            config={"globalEnabled": False},
        )
        self.assertFalse(allowed)

    def test_category_toggle_blocks_alert(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "whale", "symbol": "BTCUSDT"},
            config={
                "globalEnabled": True,
                "categories": {"whale": False},
            },
        )
        self.assertFalse(allowed)

    def test_quiet_hours_block_alert(self):
        now_local = datetime(2026, 1, 1, 23, 0, 0)
        allowed = alert_policy.should_accept_alert(
            alert={"type": "whale", "symbol": "BTCUSDT"},
            config={
                "globalEnabled": True,
                "categories": {"whale": True},
                "quietHours": {"enabled": True, "start": "22:00", "end": "06:00"},
            },
            now_local=now_local,
        )
        self.assertFalse(allowed)

    def test_session_gate_blocks_if_not_active(self):
        now_utc = datetime(2026, 1, 1, 2, 0, 0, tzinfo=timezone.utc)  # Asia session
        allowed = alert_policy.should_accept_alert(
            alert={"type": "whale", "symbol": "BTCUSDT"},
            config={
                "globalEnabled": True,
                "categories": {"whale": True},
                "activeSessions": ["US"],
            },
            now_utc=now_utc,
        )
        self.assertFalse(allowed)

    def test_category_timeframe_blocks_unlisted_tf(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "atr_expand", "symbol": "BTCUSDT", "tf": "30m"},
            config={
                "globalEnabled": True,
                "timeframes": {"atr_expand": ["1m", "5m", "15m"]},
            },
        )
        self.assertFalse(allowed)

    def test_empty_category_timeframes_blocks_all_tf_alerts(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "atr_expand", "symbol": "BTCUSDT", "tf": "5m"},
            config={
                "globalEnabled": True,
                "timeframes": {"atr_expand": []},
            },
        )
        self.assertFalse(allowed)

    def test_monitored_timeframes_fallback_blocks_hidden_tf(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "rsi_extreme", "symbol": "BTCUSDT", "tf": "30m"},
            config={
                "globalEnabled": True,
                "monitoredTimeframes": ["1m", "5m", "15m", "1h", "4h", "1d"],
            },
        )
        self.assertFalse(allowed)

    def test_new_category_toggle_blocks_macd_cross(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "macd_cross", "symbol": "BTCUSDT", "tf": "1h"},
            config={
                "globalEnabled": True,
                "categories": {"macd_cross": False},
            },
        )
        self.assertFalse(allowed)

    def test_new_category_timeframe_blocks_bb_breakout(self):
        allowed = alert_policy.should_accept_alert(
            alert={"type": "bb_breakout", "symbol": "BTCUSDT", "tf": "15m"},
            config={
                "globalEnabled": True,
                "timeframes": {"bb_breakout": ["1h", "4h"]},
            },
        )
        self.assertFalse(allowed)


if __name__ == "__main__":
    unittest.main()
