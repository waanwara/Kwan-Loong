from __future__ import annotations

import math
from typing import Any

from .fuel_model import get_fuel_parameters


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _wrap_degrees(value: float) -> float:
    return value % 360.0


def _unit_vector(direction_deg: float) -> tuple[float, float]:
    # Compass bearing: 0=N, 90=E, 180=S, 270=W
    rad = math.radians(direction_deg)
    return math.sin(rad), math.cos(rad)


def _aspect_to_upslope(aspect_downslope_deg: float) -> float:
    """Convert standard DEM aspect (downslope heading) to upslope heading where fire spreads."""
    return _wrap_degrees(aspect_downslope_deg + 180.0)


def _wind_to_downwind(wind_from_deg: float) -> float:
    """Convert meteorological wind direction (FROM) to heading direction (TO)."""
    return _wrap_degrees(wind_from_deg + 180.0)


def calculate_rate_of_spread(
    wind_speed: float,
    wind_direction: float,
    slope: float,
    aspect: float,
    fuel_model: str,
    fuel_moisture: float,
) -> dict[str, Any]:
    """Calculate a transparent MVP Rothermel-style spread baseline.

    This is a development implementation, NOT a field-operational model.
    Replace demo fuel parameters and validate the complete equations
    against a verified reference implementation before operational use.

    Units:
        wind_speed: m/s (>= 0)
        wind_direction: meteorological direction FROM, degrees clockwise from N [0, 360)
        slope: degrees inclination [0, 90]
        aspect: downslope direction from standard GIS DEM, degrees clockwise from N [0, 360)
        fuel_moisture: fraction between 0.0 and 1.0 (e.g., 0.08 = 8%)
    """
    if wind_speed < 0:
        raise ValueError("wind_speed must be >= 0")
    if not 0 <= wind_direction < 360:
        raise ValueError("wind_direction must be between 0 and 360 degrees")
    if not 0 <= slope <= 90:
        raise ValueError("slope must be between 0 and 90 degrees")
    if not 0 <= aspect < 360:
        raise ValueError("aspect must be between 0 and 360 degrees")
    if not 0 <= fuel_moisture <= 1:
        raise ValueError("fuel_moisture must be between 0 and 1")

    p = get_fuel_parameters(fuel_model)

    base_ros = p["base_ros_m_min"]

    # Moisture damping factor
    moisture_damping = _clamp(
        1.0 - (fuel_moisture / max(p["reference_moisture"], 1e-9)) * 0.55,
        0.05,
        1.0,
    )

    # Wind and slope acceleration factors
    wind_factor = 1.0 + p["wind_coefficient"] * wind_speed
    slope_factor = 1.0 + p["slope_coefficient"] * math.tan(math.radians(slope))

    ros = max(0.0, base_ros * moisture_damping * wind_factor * slope_factor)

    # Convert environmental bearings to spread force directions
    downwind = _wind_to_downwind(wind_direction)
    upslope = _aspect_to_upslope(aspect)

    wx, wy = _unit_vector(downwind)
    sx, sy = _unit_vector(upslope)

    # Weights representing influence of wind vs terrain slope
    wind_weight = min(0.85, 0.35 + 0.03 * wind_speed)
    slope_weight = min(0.65, 0.10 + 0.01 * slope)

    # Combined resultant vector
    vx = wind_weight * wx + slope_weight * sx
    vy = wind_weight * wy + slope_weight * sy

    if abs(vx) < 1e-12 and abs(vy) < 1e-12:
        direction = downwind
    else:
        direction = _wrap_degrees(math.degrees(math.atan2(vx, vy)))

    return {
        "rate_of_spread_m_min": round(ros, 4),
        "spread_direction_deg": round(direction, 2),
        "fuel_model": fuel_model,
        "intermediate": {
            "base_ros_m_min": base_ros,
            "moisture_damping": round(moisture_damping, 4),
            "wind_factor": round(wind_factor, 4),
            "slope_factor": round(slope_factor, 4),
            "effective_upslope_deg": round(upslope, 2),
            "downwind_deg": round(downwind, 2),
        },
    }