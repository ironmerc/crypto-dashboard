from __future__ import annotations

import json
import logging
from pathlib import Path


def load_cached_username(cache_file: str, logger: logging.Logger | None = None) -> str | None:
    path = Path(cache_file)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        if logger:
            logger.warning(f"Failed to read cached bot identity from {cache_file}: {exc}")
        return None

    username = data.get("username")
    if isinstance(username, str):
        username = username.strip()
        if username:
            return username
    return None


def save_cached_username(cache_file: str, username: str, logger: logging.Logger | None = None) -> None:
    if not isinstance(username, str) or not username.strip():
        return

    path = Path(cache_file)
    payload = {"username": username.strip()}
    try:
        path.write_text(json.dumps(payload), encoding="utf-8")
    except Exception as exc:
        if logger:
            logger.warning(f"Failed to write cached bot identity to {cache_file}: {exc}")

