import os
import sys
import types
import unittest


CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

if "websockets" not in sys.modules:
    sys.modules["websockets"] = types.SimpleNamespace(connect=None)
if "pandas" not in sys.modules:
    sys.modules["pandas"] = types.SimpleNamespace(DataFrame=None, Series=None)
if "numpy" not in sys.modules:
    sys.modules["numpy"] = types.SimpleNamespace(errstate=None, isnan=None, maximum=None)
if "aiohttp" not in sys.modules:
    sys.modules["aiohttp"] = types.SimpleNamespace(ClientSession=None)

from market_engine import MarketEngine  # noqa: E402


class MarketEnginePriceAlertTests(unittest.IsolatedAsyncioTestCase):
    def build_engine(self, alert):
        engine = MarketEngine()
        engine.config = {
            "priceAlerts": [alert]
        }
        engine.state = {
            "BTCUSDT": {
                "last_price": 100000.0,
                "volume_profile": {},
                "whale_delta": 0.0,
                "last_vah": 0.0,
                "last_val": 0.0,
            }
        }
        return engine

    async def exercise_trade(self, engine, trade_price):
        sent_alerts: list[dict[str, object]] = []
        synced_alert_sets: list[list[dict[str, object]]] = []

        async def fake_send_alert(
            title,
            message,
            category,
            symbol,
            severity="info",
            cooldown=60,
            tf=None,
            reason="rule_triggered",
            current_value=None,
            threshold_value=None,
            comparison=None,
            metadata=None,
            market_type="futures",
        ):
            sent_alerts.append(
                {
                    "title": title,
                    "message": message,
                    "category": category,
                    "symbol": symbol,
                    "severity": severity,
                    "cooldown": cooldown,
                    "reason": reason,
                    "current_value": current_value,
                    "threshold_value": threshold_value,
                    "comparison": comparison,
                    "metadata": metadata,
                    "market_type": market_type,
                }
            )

        async def fake_sync_price_alerts(alerts):
            synced_alert_sets.append(alerts)

        engine.send_alert = fake_send_alert
        engine.sync_price_alerts = fake_sync_price_alerts

        await engine.handle_message(
            {
                "e": "aggTrade",
                "s": "BTCUSDT",
                "p": str(trade_price),
                "q": "0.1",
                "m": False,
            },
            "futures",
        )

        return sent_alerts, synced_alert_sets

    async def test_above_price_alert_fires_on_upward_cross(self):
        engine = self.build_engine(
            {
                "id": "alert-1",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "direction": "ABOVE",
                "createdAt": 1,
            }
        )

        sent_alerts, synced_alert_sets = await self.exercise_trade(engine, 101050.0)

        self.assertEqual(len(sent_alerts), 1)
        self.assertEqual(sent_alerts[0]["category"], "price_alert")
        self.assertIn("Price Alert Above", str(sent_alerts[0]["title"]))
        self.assertIn("Price moved above your target.", str(sent_alerts[0]["message"]))
        self.assertEqual(sent_alerts[0]["symbol"], "BTCUSDT")
        self.assertEqual(sent_alerts[0]["metadata"]["direction"], "above")
        self.assertEqual(synced_alert_sets, [[]])
        self.assertEqual(engine.config["priceAlerts"], [])

    async def test_below_price_alert_ignores_upward_cross(self):
        engine = self.build_engine(
            {
                "id": "alert-1",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "direction": "BELOW",
                "createdAt": 1,
            }
        )

        sent_alerts, synced_alert_sets = await self.exercise_trade(engine, 101050.0)

        self.assertEqual(sent_alerts, [])
        self.assertEqual(synced_alert_sets, [])
        self.assertEqual(len(engine.config["priceAlerts"]), 1)

    async def test_legacy_neutral_price_alert_behaves_like_cross_alert(self):
        engine = self.build_engine(
            {
                "id": "alert-1",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "side": "NEUTRAL",
                "createdAt": 1,
            }
        )

        sent_alerts, synced_alert_sets = await self.exercise_trade(engine, 101050.0)

        self.assertEqual(len(sent_alerts), 1)
        self.assertIn("Price Alert Cross", str(sent_alerts[0]["title"]))
        self.assertEqual(sent_alerts[0]["metadata"]["trigger_direction"], "ABOVE")
        self.assertEqual(synced_alert_sets, [[]])
        self.assertEqual(engine.config["priceAlerts"], [])


if __name__ == "__main__":
    unittest.main()
