from __future__ import annotations

import math
import unittest

from wildfire_analysis.fire_propagation import _destination, simulate_fire


class TestFirePropagation(unittest.TestCase):
    def test_destination_bearing(self):
        x, y = _destination(0.0, 0.0, 100.0, 90.0)
        self.assertTrue(math.isclose(x, 100.0, abs_tol=1e-4))
        self.assertTrue(math.isclose(y, 0.0, abs_tol=1e-4))

        x, y = _destination(0.0, 0.0, 100.0, 0.0)
        self.assertTrue(math.isclose(x, 0.0, abs_tol=1e-4))
        self.assertTrue(math.isclose(y, 100.0, abs_tol=1e-4))

    def test_simulate_fire_schema_compliance(self):
        payload = {
            "ignition": {"x_m": 500000.0, "y_m": 2000000.0},
            "weather": {
                "wind_speed_m_s": 4.0,
                "wind_direction_deg": 270.0,
                "temperature_c": 30.0,
                "relative_humidity": 0.50,
            },
            "terrain": {
                "elevation_m": 500.0,
                "slope_deg": 10.0,
                "aspect_deg": 180.0,
            },
            "fuel": {
                "fuel_model": "DEMO_FOREST",
                "fuel_moisture_fraction": 0.08,
            },
            "grid": {"cell_size_m": 30.0},
            "simulation": {
                "duration_minutes": 60,
                "output_intervals_minutes": [30, 60],
            },
        }

        result = simulate_fire(payload)

        self.assertEqual(result["status"], "success")
        self.assertIn("summary", result)
        self.assertGreater(result["summary"]["rate_of_spread_m_min"], 0.0)
        self.assertEqual(result["model_version"], "mvp-0.2.0")

        predictions = result["predictions"]
        self.assertIn("30", predictions)
        self.assertIn("60", predictions)
        self.assertIn("arrival_time_grid", result)
        self.assertGreater(len(result["arrival_time_grid"]["cells"]), 1)
        self.assertIn(
            {"i": 0, "j": 0, "x_m": 500000.0, "y_m": 2000000.0, "arrival_min": 0.0},
            result["arrival_time_grid"]["cells"],
        )

        for interval in ["30", "60"]:
            coords = predictions[interval]
            self.assertEqual(len(coords), 4)
            for pt in coords:
                self.assertIn("x_m", pt)
                self.assertIn("y_m", pt)
                self.assertIsInstance(pt["x_m"], (int, float))
                self.assertIsInstance(pt["y_m"], (int, float))

    def test_simulate_fire_invalid_config(self):
        base_payload = {
            "ignition": {"x_m": 0.0, "y_m": 0.0},
            "weather": {
                "wind_speed_m_s": 2.0,
                "wind_direction_deg": 180.0,
            },
            "terrain": {
                "slope_deg": 5.0,
                "aspect_deg": 90.0,
            },
            "fuel": {
                "fuel_model": "DEMO_FOREST",
                "fuel_moisture_fraction": 0.08,
            },
            "grid": {"cell_size_m": 30.0},
            "simulation": {"duration_minutes": 60, "output_intervals_minutes": [30]},
        }

        bad_grid = dict(base_payload)
        bad_grid["grid"] = {"cell_size_m": 0.0}
        with self.assertRaises(ValueError):
            simulate_fire(bad_grid)

        bad_duration = dict(base_payload)
        bad_duration["simulation"] = {
            "duration_minutes": -10,
            "output_intervals_minutes": [30],
        }
        with self.assertRaises(ValueError):
            simulate_fire(bad_duration)

        missing_weather = dict(base_payload)
        del missing_weather["weather"]
        with self.assertRaises(ValueError):
            simulate_fire(missing_weather)

        bad_max_cells = dict(base_payload)
        bad_max_cells["grid"] = {"cell_size_m": 30.0, "max_cells": "101"}
        with self.assertRaises(ValueError):
            simulate_fire(bad_max_cells)

    def test_non_burnable_fuel_does_not_spread(self):
        payload = {
            "ignition": {"x_m": 0.0, "y_m": 0.0},
            "weather": {
                "wind_speed_m_s": 10.0,
                "wind_direction_deg": 270.0,
            },
            "terrain": {
                "slope_deg": 20.0,
                "aspect_deg": 90.0,
            },
            "fuel": {
                "fuel_model": None,
                "fuel_moisture_fraction": 0.08,
            },
            "grid": {"cell_size_m": 30.0},
            "simulation": {"duration_minutes": 60, "output_intervals_minutes": [30]},
        }

        result = simulate_fire(payload)

        self.assertEqual(result["summary"]["rate_of_spread_m_min"], 0.0)
        self.assertEqual(result["predictions"]["30"], [{"x_m": 0.0, "y_m": 0.0}])
        self.assertEqual(len(result["arrival_time_grid"]["cells"]), 1)

    def test_perimeter_uses_ros_without_minimum_cell_spread(self):
        payload = {
            "ignition": {"x_m": 0.0, "y_m": 0.0},
            "weather": {
                "wind_speed_m_s": 0.0,
                "wind_direction_deg": 0.0,
            },
            "terrain": {
                "slope_deg": 0.0,
                "aspect_deg": 0.0,
            },
            "fuel": {
                "fuel_model": "DEMO_FOREST",
                "fuel_moisture_fraction": 0.6,
            },
            "grid": {"cell_size_m": 30.0},
            "simulation": {"duration_minutes": 1, "output_intervals_minutes": [1]},
        }

        result = simulate_fire(payload)
        ros = result["summary"]["rate_of_spread_m_min"]
        coords = result["predictions"]["1"]
        max_distance = max(math.hypot(pt["x_m"], pt["y_m"]) for pt in coords)

        self.assertLess(max_distance, 30.0)
        self.assertTrue(math.isclose(max_distance, ros, abs_tol=0.02))


if __name__ == "__main__":
    unittest.main()
