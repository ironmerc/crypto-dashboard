from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas"


def load_schema(schema_filename: str) -> dict[str, Any]:
    schema_path = SCHEMAS_DIR / schema_filename
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    return True


def _resolve_ref(root_schema: dict[str, Any], ref: str) -> dict[str, Any] | None:
    if not ref.startswith("#/"):
        return None

    current: Any = root_schema
    for part in ref[2:].split("/"):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current if isinstance(current, dict) else None


def validate_by_schema_warn_only(
    payload: Any,
    schema: dict[str, Any],
    partial: bool = False,
    path: str = "$",
    root_schema: dict[str, Any] | None = None,
) -> list[str]:
    warnings: list[str] = []
    root = root_schema or schema

    if "$ref" in schema:
        resolved = _resolve_ref(root, schema["$ref"])
        if resolved is None:
            return [f"{path}: unresolved schema ref {schema['$ref']}"]
        return validate_by_schema_warn_only(payload, resolved, partial, path, root)

    expected_types = schema.get("type")
    if expected_types is not None:
        types = expected_types if isinstance(expected_types, list) else [expected_types]
        if not any(_matches_type(payload, t) for t in types):
            actual = "array" if isinstance(payload, list) else "null" if payload is None else type(payload).__name__
            warnings.append(f"{path}: expected {'|'.join(types)} got {actual}")
            return warnings

    schema_type = schema.get("type")

    if schema_type == "object" and isinstance(payload, dict):
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        if not partial and isinstance(required, list):
            for field in required:
                if field not in payload:
                    warnings.append(f"{path}.{field}: missing required field")

        for key, value in payload.items():
            if key in properties:
                warnings.extend(
                    validate_by_schema_warn_only(
                        value,
                        properties[key],
                        partial=partial,
                        path=f"{path}.{key}",
                        root_schema=root,
                    )
                )
                continue

            additional = schema.get("additionalProperties", True)
            if additional is False:
                warnings.append(f"{path}.{key}: unknown key")
                continue

            if isinstance(additional, dict):
                warnings.extend(
                    validate_by_schema_warn_only(
                        value,
                        additional,
                        partial=partial,
                        path=f"{path}.{key}",
                        root_schema=root,
                    )
                )

    if schema_type == "array" and isinstance(payload, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(payload):
                warnings.extend(
                    validate_by_schema_warn_only(
                        item,
                        item_schema,
                        partial=partial,
                        path=f"{path}[{i}]",
                        root_schema=root,
                    )
                )

    return warnings


def log_schema_warnings(scope: str, warnings: list[str]) -> None:
    for warning in warnings:
        logger.warning(f"[SchemaWarn:{scope}] {warning}")

