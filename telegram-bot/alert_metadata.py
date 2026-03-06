from __future__ import annotations

from typing import Any


def build_alert_metadata(
    reason: str = "rule_triggered",
    current_value: Any = None,
    threshold_value: Any = None,
    comparison: str | None = None,
    timeframe: str | None = None,
    session: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = {
        "reason": reason,
        "current_value": current_value,
        "threshold_value": threshold_value,
        "comparison": comparison,
        "timeframe": timeframe,
        "session": session,
    }
    if extra:
        metadata.update(extra)
    return metadata

