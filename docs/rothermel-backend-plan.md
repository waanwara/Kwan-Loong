# Rothermel Backend Integration Plan

## Current scaffold

The backend now exposes authenticated endpoints under `/api/rothermel`.

- `GET /api/rothermel/fuel-models` lists supported fuel model records.
- `POST /api/rothermel/estimate` accepts a scenario payload, optionally enriches it with live environment data, converts it into `wildfire_analysis/MODEL_INPUT_SCHEMA.json`, runs the Python `wildfire_analysis` MVP model, stores the scenario in SQLite, and returns both UI summary fields and the full model output.
- `POST /api/rothermel/estimate-from-hotspot` accepts a FIRMS-style hotspot payload and runs the same estimate flow. By default it looks up nearest live wind and fuel proxy data for the hotspot location; pass `useLiveEnvironment: false` to use MVP fallback values.
- `GET /api/data/firms/hotspots` calls the NASA FIRMS Area CSV API using the configured Vientiane / central Laos bbox.
- `GET /api/data/wind/latest?lat=...&lng=...` returns the nearest AQ Tracker wind grid point, with local `laos_wind.csv` fallback when available.
- `GET /api/data/environment?lat=...&lng=...` returns wind, optional local tree-cover sample, and an MVP fuel-model heuristic for the requested point.

The estimate now uses `wildfire_analysis.simulate_fire()` through the Node bridge in `src/services/wildfireModelAdapter.js`. It is still not a verified operational Rothermel implementation: the Python model is a Rothermel-inspired MVP baseline with a radial arrival-time grid.

Current request flow:

```text
public/js/dispatch-rothermel.js
  -> POST /api/rothermel/estimate
  -> src/routes/rothermelRoutes.js
  -> src/services/rothermelService.js
  -> src/services/wildfireModelAdapter.js
  -> src/services/geoProjection.js
  -> python -m wildfire_analysis.cli
  -> wildfire_analysis.fire_propagation.simulate_fire()
```

Unit conversions performed by the Node adapter:

- `windSpeedKmh / 3.6` -> `weather.wind_speed_m_s`
- `slopePercent` -> `terrain.slope_deg` using `atan(percent / 100)`
- `fuelMoisturePercent / 100` -> `fuel.fuel_moisture_fraction`
- `GR1`, `SH2`, `TU5` -> `DEMO_GRASS`, `DEMO_SHRUB`, `DEMO_FOREST`
- WGS84 `latitude`/`longitude` -> UTM metres for `ignition.x_m` / `ignition.y_m`
- Model output metre coordinates -> GeoJSON `[longitude, latitude]`

FIRMS configuration:

```env
FIRMS_MAP_KEY=replace-with-firms-map-key
FIRMS_DEFAULT_SOURCE=VIIRS_SNPP_NRT
FIRMS_DEFAULT_BBOX=101.5,17.0,103.5,19.0
FIRMS_DEFAULT_DAY_RANGE=1
WIND_API_URL=https://aq-tracker-servir.adpc.net/latest/
WIND_CSV_PATH=laos_wind.csv
WIND_CSV_DIRECTION_CONVENTION=to
FOREST_CSV_PATH=laos_forest.csv
GFW_API_KEY=replace-with-gfw-api-key-if-using-forest-fetch
```

Environment behavior:

- AQ Tracker U/V wind components are converted to wind speed and meteorological
  direction-from degrees before entering the model.
- Legacy `apitocsv.py` wind CSV values are treated as direction-to values by
  default, then converted by 180 degrees for the model.
- `laos_forest.csv` is optional. If present, nearest `tree_cover_pct` maps to
  `GR1`, `SH2`, or `TU5` as an MVP fuel proxy.
- If tree cover is unavailable, the service falls back to `SH2`.

Current FIRMS smoke test result for the configured bbox/day range:

```text
source: VIIRS_SNPP_NRT
bbox: 101.5,17,103.5,19
dayRange: 1
count: 0
```

This means the API connector works, but FIRMS returned no hotspot for the current
MVP area/time window during the test.

CRS behavior:

- The adapter chooses a UTM zone from the scenario longitude.
- Vientiane / central Laos currently resolves to UTM Zone 48N (`EPSG:32648`).
- Western Laos locations can resolve to UTM Zone 47N (`EPSG:32647`) without a code change.
- GeoJSON output follows `[longitude, latitude]` coordinate order.

Known limitation: this is still point-origin projection plus simplified model
output conversion. It does not yet perform raster alignment, PostGIS spatial
queries, tiled outputs, or data-source-specific CRS normalization.

## Database shape

SQLite is the active database for this stage. The default path is `./data/kwanlong.sqlite`, or `SQLITE_DB_PATH` when set.

Core tables:

- `users`: id, email, password_hash, name, role, created_at
- `fuel_models`: id, code, name, category, parameters_json, source, version, created_at
- `weather_observations`: id, latitude, longitude, wind_speed_kmh, wind_direction_deg, temperature_c, relative_humidity, observed_at, source
- `terrain_samples`: id, latitude, longitude, slope_percent, aspect_deg, elevation_m, source
- `fire_scenarios`: id, created_by, fuel_model_id, latitude, longitude, weather_observation_id, terrain_sample_id, input_json, estimate_json, created_at
- `dispatch_logs`: id, scenario_id, action, payload_json, created_by, created_at

## When to move beyond SQLite

Use PostgreSQL when the app needs multiple backend containers, concurrent field users, strict audit trails, geospatial queries, or large historical weather/terrain datasets. PostgreSQL with PostGIS is the better long-term target for map-heavy fire behavior work.

## Docker path

Start with a Dockerfile for the Node app. Add Docker Compose when you introduce PostgreSQL, Redis, or a background worker for pulling weather, satellite, or terrain feeds.

Recommended progression:

1. Local Node app plus SQLite file.
2. Dockerized Node app plus mounted SQLite volume.
3. Docker Compose with Node, PostgreSQL/PostGIS, and a worker service.
4. Production deployment with managed PostgreSQL/PostGIS and scheduled data ingestion.

## Running with Docker

For local Docker runs over plain HTTP, keep `COOKIE_SECURE=false`.

Use:

```bash
docker compose up --build
```

For production behind HTTPS, set a strong `SESSION_SECRET` and `COOKIE_SECURE=true`.
