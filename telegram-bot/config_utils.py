from __future__ import annotations

from copy import deepcopy
from typing import Any

THRESHOLD_KEYS = {
    "whaleMinAmount",
    "liquidationMinAmount",
    "oiSpikePercentage",
    "fundingExtremeRate",
    "atrExpansionRatio",
    "whaleMomentumDelta",
    "rvolMultiplier",
    "rsiOverbought",
    "rsiOversold",
    "emaSeparationPct",
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def normalize_config_shape(config: dict[str, Any]) -> tuple[dict[str, Any], bool, list[str]]:
    """
    Normalizes legacy config shapes to current schema shape.

    Current migration:
    - thresholds.<thresholdKey>: number  -> thresholds.global.<thresholdKey>: number
    - drops non-object entries under thresholds except known legacy flat threshold keys
    """
    normalized = deepcopy(config)
    changed = False
    notes: list[str] = []

    thresholds = normalized.get("thresholds")
    if not isinstance(thresholds, dict):
        return normalized, changed, notes

    global_thresholds = thresholds.get("global")
    if not isinstance(global_thresholds, dict):
        global_thresholds = {}
        changed = True

    rebuilt_thresholds: dict[str, Any] = {}
    for key, value in thresholds.items():
        if key == "global":
            continue

        if isinstance(value, dict):
            rebuilt_thresholds[key] = value
            continue

        # Legacy flat keys moved under thresholds.global if missing there.
        if key in THRESHOLD_KEYS and _is_number(value):
            if key not in global_thresholds:
                global_thresholds[key] = value
            changed = True
            continue

        # Unknown non-object entries are dropped to satisfy schema shape.
        changed = True

    rebuilt_thresholds["global"] = global_thresholds

    if rebuilt_thresholds != thresholds:
        normalized["thresholds"] = rebuilt_thresholds
        changed = True
        notes.append("normalized thresholds shape to object-per-scope format")

    return normalized, changed, notes

