from __future__ import annotations

import unittest

from wildfire_analysis.fuel_moisture import estimate_fuel_moisture


class TestFuelMoisture(unittest.TestCase):
    def test_relative_humidity_uses_fraction_units(self):
        dry = estimate_fuel_moisture(
            relative_humidity=0.30,
            temperature_c=35.0,
            rainfall_mm=0.0,
        )
        humid = estimate_fuel_moisture(
            relative_humidity=0.80,
            temperature_c=35.0,
            rainfall_mm=0.0,
        )

        self.assertGreater(humid, dry)

    def test_rejects_percent_units(self):
        with self.assertRaises(ValueError):
            estimate_fuel_moisture(
                relative_humidity=65.0,
                temperature_c=30.0,
            )


if __name__ == "__main__":
    unittest.main()
