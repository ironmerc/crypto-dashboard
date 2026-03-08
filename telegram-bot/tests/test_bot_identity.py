import os
import sys
import tempfile
import unittest

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import bot_identity  # noqa: E402


class BotIdentityTests(unittest.TestCase):
    def test_load_cached_username_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "missing.json")
            self.assertIsNone(bot_identity.load_cached_username(path))

    def test_save_and_load_cached_username_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bot_identity.json")
            bot_identity.save_cached_username(path, "godmodefutures_bot")
            loaded = bot_identity.load_cached_username(path)
            self.assertEqual(loaded, "godmodefutures_bot")

    def test_load_cached_username_invalid_json_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bot_identity.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{not valid json")
            self.assertIsNone(bot_identity.load_cached_username(path))


if __name__ == "__main__":
    unittest.main()

