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

    async def exercise_trade(self, engine, trade_price, market_type="futures"):
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
            market_type,
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

    async def test_alert_scoped_to_futures_does_not_fire_on_spot_stream(self):
        """A futures-scoped alert must not be consumed by a spot trade."""
        engine = self.build_engine(
            {
                "id": "alert-futures",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "direction": "ABOVE",
                "market_type": "futures",
                "createdAt": 1,
            }
        )

        # Simulate a spot trade crossing the level
        sent_alerts, synced_alert_sets = await self.exercise_trade(engine, 101050.0, market_type="spot")

        self.assertEqual(sent_alerts, [], "spot stream must not fire a futures-scoped alert")
        self.assertEqual(synced_alert_sets, [])
        self.assertEqual(len(engine.config["priceAlerts"]), 1, "alert must remain unconsumed")

    async def test_alert_scoped_to_futures_fires_on_futures_stream(self):
        """A futures-scoped alert fires when the futures stream crosses."""
        engine = self.build_engine(
            {
                "id": "alert-futures",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "direction": "ABOVE",
                "market_type": "futures",
                "createdAt": 1,
            }
        )

        sent_alerts, _ = await self.exercise_trade(engine, 101050.0, market_type="futures")

        self.assertEqual(len(sent_alerts), 1)
        self.assertEqual(engine.config["priceAlerts"], [])

    async def test_legacy_alert_without_market_type_fires_on_any_stream(self):
        """Alerts created before market_type was added must still fire on both streams."""
        engine = self.build_engine(
            {
                "id": "legacy-alert",
                "symbol": "BTCUSDT",
                "price": 101000.0,
                "direction": "ABOVE",
                # no market_type field
                "createdAt": 1,
            }
        )

        sent_alerts, _ = await self.exercise_trade(engine, 101050.0, market_type="spot")

        self.assertEqual(len(sent_alerts), 1, "legacy alert (no market_type) must fire on any stream")

    async def test_same_ticker_spot_and_futures_alerts_are_independent(self):
        """With both spot and futures alerts for the same ticker, each fires only on its stream."""
        engine = MarketEngine()
        engine.config = {
            "priceAlerts": [
                {
                    "id": "alert-futures",
                    "symbol": "BTCUSDT",
                    "price": 101000.0,
                    "direction": "ABOVE",
                    "market_type": "futures",
                    "createdAt": 1,
                },
                {
                    "id": "alert-spot",
                    "symbol": "BTCUSDT",
                    "price": 101000.0,
                    "direction": "ABOVE",
                    "market_type": "spot",
                    "createdAt": 2,
                },
            ]
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

        sent_alerts, _ = await self.exercise_trade(engine, 101050.0, market_type="futures")

        self.assertEqual(len(sent_alerts), 1)
        self.assertEqual(sent_alerts[0]["metadata"]["alert_id"], "alert-futures")
        # spot alert must still be pending
        remaining_ids = {a["id"] for a in engine.config["priceAlerts"]}
        self.assertIn("alert-spot", remaining_ids)
        self.assertNotIn("alert-futures", remaining_ids)


if __name__ == "__main__":
    unittest.main()
