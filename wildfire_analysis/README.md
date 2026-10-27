# Wildfire Analysis Package

This package contains the current MVP model code for wildfire spread analysis.
It is designed as a backend-facing Python package, not as a complete data
pipeline or map application.

## What This Package Does

- Calculates a transparent Rothermel-style heuristic rate of spread.
- Estimates spread direction from wind and terrain aspect.
- Generates a directional arrival-time grid around the ignition point.
- Keeps simple directional/elliptical perimeter vertices for compatibility.
- Provides JSON schemas for the backend/model contract.
- Provides demo fuel mappings and development-only fuel moisture estimation.

## What This Package Does Not Do Yet

- It does not fetch external data from FIRMS, AQ Tracker, GEOS-5, NASADEM,
  Dynamic World, or GFW.
- It does not reproject lat/lon coordinates into metres.
- It does not generate GeoJSON.
- It does not implement a complete validated Rothermel model.
- It does not implement calibrated neighbor-based cellular automata, barriers,
  or Fast Marching propagation.
- It does not perform strategic historical-risk or choke-point analysis.

## Files

```text
wildfire_analysis/
├── __init__.py
├── BACKEND_INTEGRATION.md
├── DATA_DICTIONARY.md
├── MODEL_INPUT_SCHEMA.json
├── MODEL_OUTPUT_SCHEMA.json
├── fire_propagation.py
├── fuel_mapping.json
├── fuel_model.py
├── fuel_moisture.py
├── rothermel.py
├── sample_input.json
├── sample_output.json
├── test_model.py
└── tests/
    ├── test_propagation.py
    └── test_rothermel.py
```

## Usage

From the repository root:

```powershell
python -m unittest discover -s wildfire_analysis\tests
python -m wildfire_analysis.test_model
```

`test_model.py` reads `sample_input.json`, runs `simulate_fire`, and writes
`sample_output.json`.

## Input Assumptions

The model expects preprocessed local inputs:

- `ignition.x_m`, `ignition.y_m`: projected metre coordinates.
- `weather.wind_speed_m_s`: metres per second.
- `weather.wind_direction_deg`: meteorological direction the wind comes from.
- `terrain.slope_deg`: slope angle in degrees.
- `terrain.aspect_deg`: standard DEM downslope aspect.
- `fuel.fuel_model`: a key in `fuel_mapping.json`.
- `fuel.fuel_moisture_fraction`: `0.0..1.0`.

Do not pass WGS84 latitude/longitude directly to the propagation model. Convert
to a projected CRS first, then convert model output back to WGS84 GeoJSON in the
backend.

## Scientific Warning

The current implementation is suitable for software integration testing and
prototype visualization only. Demo fuel parameters and radial arrival-time
geometry must be replaced or calibrated before the outputs are used for
research claims, planning decisions, or field operations.
