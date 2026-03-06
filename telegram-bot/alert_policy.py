from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def get_active_session(now_utc: datetime | None = None) -> str:
    now = now_utc or datetime.now(timezone.utc)
    hour = now.hour
    if 0 <= hour < 8:
        return "Asia"
    if 8 <= hour < 16:
        return "London"
    return "US"


def is_within_time_range(start_str: str, end_str: str, now_local: datetime | None = None) -> bool:
    now = now_local or datetime.now()
    current_mins = now.hour * 60 + now.minute

    start_h, start_m = map(int, start_str.split(":"))
    end_h, end_m = map(int, end_str.split(":"))

    start_mins = start_h * 60 + start_m
    end_mins = end_h * 60 + end_m

    if start_mins <= end_mins:
        return start_mins <= current_mins <= end_mins
    return current_mins >= start_mins or current_mins <= end_mins


def build_cooldown_key(alert: dict[str, Any]) -> str:
    alert_type = str(alert.get("type") or alert.get("category") or "default")
    symbol = str(alert.get("symbol") or "*")
    tf = str(alert.get("tf") or "*")
    return f"{alert_type}|{symbol}|{tf}"


def should_accept_alert(
    alert: dict[str, Any],
    config: dict[str, Any],
    now_local: datetime | None = None,
    now_utc: datetime | None = None,
) -> bool:
    if not config.get("globalEnabled", True):
        return False

    category = str(alert.get("category") or alert.get("type") or "default")
    if config.get("categories", {}).get(category) is False:
        return False

    allowed_sessions = config.get("activeSessions", ["London", "US", "Asia"])
    if get_active_session(now_utc) not in allowed_sessions:
        return False

    tf = alert.get("tf")
    if tf:
        enabled_tfs = config.get("timeframes", {}).get(category)
        if isinstance(enabled_tfs, list) and enabled_tfs and tf not in enabled_tfs:
            return False

    quiet_hours = config.get("quietHours", {})
    if quiet_hours.get("enabled") and quiet_hours.get("start") and quiet_hours.get("end"):
        if is_within_time_range(quiet_hours["start"], quiet_hours["end"], now_local=now_local):
            return False

    return True

