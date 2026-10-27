from __future__ import annotations

from typing import Optional


def estimate_fuel_moisture(
    relative_humidity: float,
    temperature_c: float,
    rainfall_mm: float = 0.0,
    previous_moisture: Optional[float] = None,
) -> float:
    """Development-only fuel-moisture estimator.

    Returns a fraction, e.g. 0.08 = 8%.
    NOT a validated operational dead/live fuel moisture model.
    """
    if not 0 <= relative_humidity <= 1:
        raise ValueError("relative_humidity must be 0..1")
    if rainfall_mm < 0:
        raise ValueError("rainfall_mm must be >= 0")

    relative_humidity_percent = relative_humidity * 100.0
    estimate = (
        0.03
        + 0.0012 * relative_humidity_percent
        + max(0.0, 0.002 * (25.0 - temperature_c))
        + min(0.08, 0.004 * rainfall_mm)
    )

    if previous_moisture is not None:
        if not 0 <= previous_moisture <= 1:
            raise ValueError("previous_moisture must be 0..1")
        estimate = 0.7 * previous_moisture + 0.3 * estimate

    return max(0.01, min(0.60, estimate))
