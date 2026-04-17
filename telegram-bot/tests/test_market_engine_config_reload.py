import os
import sys
import unittest


CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

from market_engine import MarketEngine  # noqa: E402


class MarketEngineConfigReloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_sync_monitored_symbols_initializes_new_symbols_after_reload(self):
        engine = MarketEngine()
        engine.monitored_symbols = [
            {"symbol": "BTCUSDT", "type": "futures"},
            {"symbol": "SOLUSDT", "type": "futures"},
        ]
        engine.state = {
            "BTCUSDT": {
                "type": "futures",
                "klines": {"1h": []},
            }
        }

        initialized: list[dict[str, str]] = []

        async def fake_init_symbol_state(symbol_obj):
            initialized.append(symbol_obj)
            engine.state[symbol_obj["symbol"]] = {
                "type": symbol_obj["type"],
                "klines": {"1h": []},
            }

        engine.init_symbol_state = fake_init_symbol_state  # type: ignore[method-assign]

        await engine.sync_monitored_symbol_state()

        self.assertEqual(
            initialized,
            [{"symbol": "SOLUSDT", "type": "futures"}],
        )
        self.assertIn("SOLUSDT", engine.state)


if __name__ == "__main__":
    unittest.main()
