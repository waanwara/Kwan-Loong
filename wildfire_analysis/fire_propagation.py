from __future__ import annotations

import math
from typing import Any

from .rothermel import calculate_rate_of_spread


def _wrap_degrees(value: float) -> float:
    return value % 360.0


def _destination(
    x: float, y: float, distance_m: float, direction_deg: float
) -> tuple[float, float]:
    # Compass bearing: 0=N, 90=E, 180=S, 270=W
    rad = math.radians(direction_deg)
    return (
        x + distance_m * math.sin(rad),
        y + distance_m * math.cos(rad),
    )


def _require_mapping(config: dict[str, Any], key: str) -> dict[str, Any]:
    value = config.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _require_number(config: dict[str, Any], section: str, key: str) -> float:
    if key not in config:
        raise ValueError(f"{section}.{key} is required")
    try:
        return float(config[key])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{section}.{key} must be a number") from exc


def _require_int(config: dict[str, Any], section: str, key: str) -> int:
    if key not in config:
        raise ValueError(f"{section}.{key} is required")
    try:
        value = int(config[key])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{section}.{key} must be an integer") from exc
    if value != config[key] and not (
        isinstance(config[key], float) and config[key].is_integer()
    ):
        raise ValueError(f"{section}.{key} must be an integer")
    return value


def _optional_int(
    config: dict[str, Any], section: str, key: str, default: int
) -> int:
    if key not in config:
        return default
    return _require_int(config, section, key)


def _normalize_horizons(raw_horizons: Any, duration: int) -> list[int]:
    if not isinstance(raw_horizons, list) or not raw_horizons:
        raise ValueError("simulation.output_intervals_minutes must be a non-empty list")

    horizons: list[int] = []
    for raw in raw_horizons:
        try:
            minutes = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("simulation.output_intervals_minutes must contain integers") from exc
        if minutes != raw and not (isinstance(raw, float) and raw.is_integer()):
            raise ValueError("simulation.output_intervals_minutes must contain integers")
        if minutes <= 0:
            raise ValueError("simulation.output_intervals_minutes values must be > 0")
        if minutes > duration:
            raise ValueError(
                "simulation.output_intervals_minutes values must be <= duration_minutes"
            )
        horizons.append(minutes)

    if len(set(horizons)) != len(horizons):
        raise ValueError("simulation.output_intervals_minutes values must be unique")
    return sorted(horizons)


def _bearing_from_delta(dx: float, dy: float) -> float:
    return _wrap_degrees(math.degrees(math.atan2(dx, dy)))


def _angle_difference(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _directional_ratio(angle_from_head: float) -> float:
    """Return an MVP directional spread ratio for head/flank/backing fire."""
    flank_ratio = 0.45
    backing_ratio = 0.15

    if angle_from_head <= 90.0:
        return flank_ratio + (1.0 - flank_ratio) * ((90.0 - angle_from_head) / 90.0)
    return backing_ratio + (flank_ratio - backing_ratio) * (
        (180.0 - angle_from_head) / 90.0
    )


def _build_arrival_time_grid(
    x0: float,
    y0: float,
    cell_size: float,
    duration: int,
    ros: float,
    direction: float,
    max_cells: int,
) -> dict[str, Any]:
    """Build a small deterministic arrival-time grid around the ignition point.

    This is a radial MVP approximation. It is not a calibrated cellular automaton
    with neighbor-to-neighbor fuel transitions or barriers.
    """
    if ros <= 0:
        return {
            "cell_size_m": cell_size,
            "origin_x_m": round(x0, 2),
            "origin_y_m": round(y0, 2),
            "cells": [
                {
                    "i": 0,
                    "j": 0,
                    "x_m": round(x0, 2),
                    "y_m": round(y0, 2),
                    "arrival_min": 0.0,
                }
            ],
        }

    max_distance = ros * duration
    radius_cells = max(1, math.ceil(max_distance / cell_size))
    radius_cells = min(radius_cells, max_cells // 2)

    cells: list[dict[str, float | int]] = []
    for j in range(-radius_cells, radius_cells + 1):
        for i in range(-radius_cells, radius_cells + 1):
            x = x0 + i * cell_size
            y = y0 + j * cell_size
            dx = x - x0
            dy = y - y0
            distance = math.hypot(dx, dy)

            if distance == 0:
                arrival = 0.0
            else:
                bearing = _bearing_from_delta(dx, dy)
                ratio = max(
                    0.01,
                    _directional_ratio(_angle_difference(bearing, direction)),
                )
                arrival = distance / (ros * ratio)

            if arrival <= duration:
                cells.append(
                    {
                        "i": i,
                        "j": j,
                        "x_m": round(x, 2),
                        "y_m": round(y, 2),
                        "arrival_min": round(arrival, 2),
                    }
                )

    return {
        "cell_size_m": cell_size,
        "origin_x_m": round(x0, 2),
        "origin_y_m": round(y0, 2),
        "cells": cells,
    }


def _is_burnable_fuel_model(fuel_model: str | None) -> bool:
    return bool(
        fuel_model
        and fuel_model.strip().lower() not in {"none", "null", "non_burnable"}
    )


def simulate_fire(config: dict[str, Any]) -> dict[str, Any]:
    """Run a deterministic directional fire-spread MVP simulation.

    The function expects the nested MODEL_INPUT_SCHEMA.json shape. It returns
    compatibility perimeter points plus a radial arrival-time grid for map/API
    integration tests.
    """
    ignition = _require_mapping(config, "ignition")
    weather = _require_mapping(config, "weather")
    terrain = _require_mapping(config, "terrain")
    fuel = _require_mapping(config, "fuel")
    grid_cfg = _require_mapping(config, "grid")
    sim_cfg = _require_mapping(config, "simulation")

    x0 = _require_number(ignition, "ignition", "x_m")
    y0 = _require_number(ignition, "ignition", "y_m")
    cell_size = _require_number(grid_cfg, "grid", "cell_size_m")
    max_cells = _optional_int(grid_cfg, "grid", "max_cells", 101)
    duration = _require_int(sim_cfg, "simulation", "duration_minutes")
    horizons = _normalize_horizons(sim_cfg.get("output_intervals_minutes"), duration)

    wind_speed = _require_number(weather, "weather", "wind_speed_m_s")
    wind_direction = _require_number(weather, "weather", "wind_direction_deg")
    slope = _require_number(terrain, "terrain", "slope_deg")
    aspect = _require_number(terrain, "terrain", "aspect_deg")
    fuel_model = fuel.get("fuel_model")
    if fuel_model is not None:
        fuel_model = str(fuel_model)
    fuel_moisture = _require_number(fuel, "fuel", "fuel_moisture_fraction")

    if cell_size <= 0:
        raise ValueError("cell_size_m must be > 0")
    if duration <= 0:
        raise ValueError("duration_minutes must be > 0")
    if max_cells < 3:
        raise ValueError("grid.max_cells must be >= 3")

    predictions: dict[str, list[dict[str, float]]] = {}

    if not _is_burnable_fuel_model(fuel_model):
        arrival_time_grid = _build_arrival_time_grid(
            x0=x0,
            y0=y0,
            cell_size=cell_size,
            duration=duration,
            ros=0.0,
            direction=0.0,
            max_cells=max_cells,
        )
        for minutes in horizons:
            predictions[str(minutes)] = [
                {"x_m": round(x0, 2), "y_m": round(y0, 2)}
            ]
        return {
            "status": "success",
            "model_version": "mvp-0.2.0",
            "summary": {
                "rate_of_spread_m_min": 0.0,
                "spread_direction_deg": 0.0,
                "fuel_model_applied": fuel_model or "non_burnable",
                "intermediate_factors": {"burnable": False},
            },
            "predictions": predictions,
            "arrival_time_grid": arrival_time_grid,
            "metadata": {
                "cell_size_m": cell_size,
                "duration_minutes": duration,
                "assumptions": [
                    "non-burnable fuel class produces no spread",
                    "single point ignition",
                    "non-operational research baseline",
                ],
            },
        }

    ros_result = calculate_rate_of_spread(
        wind_speed=wind_speed,
        wind_direction=wind_direction,
        slope=slope,
        aspect=aspect,
        fuel_model=str(fuel_model),
        fuel_moisture=fuel_moisture,
    )

    ros = ros_result["rate_of_spread_m_min"]
    direction = ros_result["spread_direction_deg"]
    arrival_time_grid = _build_arrival_time_grid(
        x0=x0,
        y0=y0,
        cell_size=cell_size,
        duration=duration,
        ros=ros,
        direction=direction,
        max_cells=max_cells,
    )

    for minutes_raw in horizons:
        minutes = int(minutes_raw)

        head_dist = ros * minutes
        flank_dist = head_dist * 0.45
        backing_dist = head_dist * 0.15

        head = _destination(x0, y0, head_dist, direction)
        right_flank = _destination(x0, y0, flank_dist, _wrap_degrees(direction + 90.0))
        backing = _destination(x0, y0, backing_dist, _wrap_degrees(direction + 180.0))
        left_flank = _destination(x0, y0, flank_dist, _wrap_degrees(direction - 90.0))

        predictions[str(minutes)] = [
            {"x_m": round(head[0], 2), "y_m": round(head[1], 2)},
            {"x_m": round(right_flank[0], 2), "y_m": round(right_flank[1], 2)},
            {"x_m": round(backing[0], 2), "y_m": round(backing[1], 2)},
            {"x_m": round(left_flank[0], 2), "y_m": round(left_flank[1], 2)},
        ]

    return {
        "status": "success",
        "model_version": "mvp-0.2.0",
        "summary": {
            "rate_of_spread_m_min": ros,
            "spread_direction_deg": direction,
            "fuel_model_applied": ros_result["fuel_model"],
            "intermediate_factors": ros_result.get("intermediate", {}),
        },
        "predictions": predictions,
        "arrival_time_grid": arrival_time_grid,
        "metadata": {
            "cell_size_m": cell_size,
            "duration_minutes": duration,
            "assumptions": [
                "single point ignition",
                "uniform steady-state weather, terrain, and fuel",
                "Rothermel-inspired heuristic ROS baseline",
                "radial directional arrival-time grid, not calibrated cellular automata",
                "perimeter predictions are compatibility ellipse vertices",
                "non-operational research baseline",
            ],
        },
    }
