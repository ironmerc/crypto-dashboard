import os
import sys
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import debounce  # noqa: E402


class MarketEngineDebounceTests(unittest.TestCase):
    def test_debounced_state_change_requires_two_confirmations(self):
        debounce_state = {}
        next_state, changed = debounce.debounced_state_change(
            debounce_state=debounce_state,
            key="regime:1h",
            current="Range",
            candidate="Uptrend (Strong)",
            confirmations=2,
        )
        self.assertEqual(next_state, "Range")
        self.assertFalse(changed)

        next_state, changed = debounce.debounced_state_change(
            debounce_state=debounce_state,
            key="regime:1h",
            current="Range",
            candidate="Uptrend (Strong)",
            confirmations=2,
        )
        self.assertEqual(next_state, "Uptrend (Strong)")
        self.assertTrue(changed)

    def test_debounced_state_change_resets_when_candidate_equals_current(self):
        debounce_state = {"volatility:5m": {"candidate": "Expansion", "count": 1}}

        next_state, changed = debounce.debounced_state_change(
            debounce_state=debounce_state,
            key="volatility:5m",
            current="Normal",
            candidate="Normal",
            confirmations=2,
        )
        self.assertEqual(next_state, "Normal")
        self.assertFalse(changed)
        self.assertNotIn("volatility:5m", debounce_state)


if __name__ == "__main__":
    unittest.main()
