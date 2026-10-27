"""Wildfire Analysis and Fire Spread Simulation Package."""

from .fire_propagation import simulate_fire
from .rothermel import calculate_rate_of_spread

__version__ = "0.2.0"

__all__ = [
    "simulate_fire",
    "calculate_rate_of_spread",
]
