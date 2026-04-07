import os
import sys
import unittest
from unittest.mock import patch

CURRENT_DIR = os.path.dirname(__file__)
BOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

import bot_identity  # noqa: E402


class BotIdentityTests(unittest.TestCase):
    def test_load_cached_username_missing_file(self):
        path = "missing.json"
        with patch("bot_identity.Path.exists", return_value=False):
            self.assertIsNone(bot_identity.load_cached_username(path))

    def test_save_and_load_cached_username_round_trip(self):
        path = "bot_identity.json"
        with patch("bot_identity.Path.write_text") as write_text, patch(
            "bot_identity.Path.exists", return_value=True
        ), patch(
            "bot_identity.Path.read_text", return_value='{"username": "godmodefutures_bot"}'
        ):
            bot_identity.save_cached_username(path, "godmodefutures_bot")
            loaded = bot_identity.load_cached_username(path)
        self.assertEqual(loaded, "godmodefutures_bot")
        write_text.assert_called_once()

    def test_load_cached_username_invalid_json_returns_none(self):
        path = "bot_identity.json"
        with patch("bot_identity.Path.exists", return_value=True), patch(
            "bot_identity.Path.read_text", return_value="{not valid json"
        ):
            self.assertIsNone(bot_identity.load_cached_username(path))


if __name__ == "__main__":
    unittest.main()
