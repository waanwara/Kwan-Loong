from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_MAPPING_PATH = Path(__file__).with_name("fuel_mapping.json")


def _load_mapping() -> dict[str, Any]:
    with _MAPPING_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_fuel_parameters(fuel_model: str) -> dict[str, Any]:
    mapping = _load_mapping()
    models = mapping.get("fuel_models", {})

    if fuel_model not in models:
        available = ", ".join(sorted(models))
        raise ValueError(
            f"Unknown fuel model '{fuel_model}'. Available: {available}"
        )

    return models[fuel_model]


def classify_land_cover(land_cover_class: str) -> dict[str, Any]:
    """Return the current DEMO land-cover -> fuel mapping."""
    mapping = _load_mapping()
    classes = mapping.get("land_cover_mapping", {})
    key = land_cover_class.strip().lower()

    if key not in classes:
        raise ValueError(f"Unknown land-cover class '{land_cover_class}'")

    return classes[key]
