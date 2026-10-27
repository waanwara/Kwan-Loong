from __future__ import annotations

import math
import unittest

from wildfire_analysis.rothermel import (
    _aspect_to_upslope,
    _clamp,
    _unit_vector,
    _wind_to_downwind,
    _wrap_degrees,
    calculate_rate_of_spread,
)


class TestRothermel(unittest.TestCase):
    def test_angle_and_vector_helpers(self):
        self.assertEqual(_wrap_degrees(360.0), 0.0)
        self.assertEqual(_wrap_degrees(-90.0), 270.0)
        self.assertEqual(_wrap_degrees(450.0), 90.0)

        self.assertEqual(_wind_to_downwind(270.0), 90.0)
        self.assertEqual(_wind_to_downwind(0.0), 180.0)

        # Downslope North (0 deg) -> Upslope South (180 deg)
        self.assertEqual(_aspect_to_upslope(0.0), 180.0)
        self.assertEqual(_aspect_to_upslope(90.0), 270.0)

        # Unit vector checks: 0 deg -> North (0, 1), 90 deg -> East (1, 0)
        sx, sy = _unit_vector(0.0)
        self.assertTrue(math.isclose(sx, 0.0, abs_tol=1e-6))
        self.assertTrue(math.isclose(sy, 1.0, abs_tol=1e-6))

        ex, ey = _unit_vector(90.0)
        self.assertTrue(math.isclose(ex, 1.0, abs_tol=1e-6))
        self.assertTrue(math.isclose(ey, 0.0, abs_tol=1e-6))

    def test_clamp(self):
        self.assertEqual(_clamp(0.5, 0.0, 1.0), 0.5)
        self.assertEqual(_clamp(-1.0, 0.0, 1.0), 0.0)
        self.assertEqual(_clamp(1.5, 0.0, 1.0), 1.0)

    def test_calculate_rate_of_spread_valid(self):
        res = calculate_rate_of_spread(
            wind_speed=5.0,
            wind_direction=270.0,
            slope=15.0,
            aspect=270.0,
            fuel_model="DEMO_FOREST",
            fuel_moisture=0.08,
        )

        self.assertIn("rate_of_spread_m_min", res)
        self.assertIn("spread_direction_deg", res)
        self.assertGreater(res["rate_of_spread_m_min"], 0.0)
        self.assertTrue(math.isclose(res["spread_direction_deg"], 90.0, abs_tol=1.0))

    def test_calculate_rate_of_spread_moisture_impact(self):
        dry_res = calculate_rate_of_spread(
            wind_speed=3.0,
            wind_direction=0.0,
            slope=0.0,
            aspect=0.0,
            fuel_model="DEMO_FOREST",
            fuel_moisture=0.05,
        )
        wet_res = calculate_rate_of_spread(
            wind_speed=3.0,
            wind_direction=0.0,
            slope=0.0,
            aspect=0.0,
            fuel_model="DEMO_FOREST",
            fuel_moisture=0.20,
        )
        self.assertGreater(dry_res["rate_of_spread_m_min"], wet_res["rate_of_spread_m_min"])

    def test_calculate_rate_of_spread_input_validation(self):
        with self.assertRaises(ValueError):
            calculate_rate_of_spread(-1.0, 180.0, 10.0, 0.0, "DEMO_FOREST", 0.1)

        with self.assertRaises(ValueError):
            calculate_rate_of_spread(5.0, 180.0, 95.0, 0.0, "DEMO_FOREST", 0.1)

        with self.assertRaises(ValueError):
            calculate_rate_of_spread(5.0, 180.0, 10.0, 0.0, "DEMO_FOREST", 1.5)


if __name__ == "__main__":
    unittest.main()