const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { modelOutputToGeoJson, wgs84ToUtm } = require('./geoProjection');

const FUEL_MODEL_MAPPING = {
    GR1: 'DEMO_GRASS',
    SH2: 'DEMO_SHRUB',
    TU5: 'DEMO_FOREST'
};

function slopePercentToDegrees(slopePercent) {
    return Math.atan(slopePercent / 100) * 180 / Math.PI;
}

function buildModelInput(scenario) {
    const fuelModel = FUEL_MODEL_MAPPING[scenario.fuelModel.id];
    if (!fuelModel) {
        throw new Error(`No wildfire_analysis fuel mapping for ${scenario.fuelModel.id}`);
    }

    const projection = wgs84ToUtm({
        latitude: scenario.latitude,
        longitude: scenario.longitude
    });

    return {
        ignition: {
            x_m: projection.easting,
            y_m: projection.northing
        },
        weather: {
            wind_speed_m_s: scenario.windSpeedKmh / 3.6,
            wind_direction_deg: scenario.windDirectionDeg,
            temperature_c: scenario.temperatureC,
            relative_humidity: scenario.relativeHumidityFraction,
            rainfall_mm_day: scenario.rainfallMmDay
        },
        terrain: {
            elevation_m: scenario.elevationM,
            slope_deg: slopePercentToDegrees(scenario.slopePercent),
            aspect_deg: scenario.aspectDeg
        },
        fuel: {
            fuel_model: fuelModel,
            fuel_load_kg_m2: scenario.fuelModel.typicalFuelLoadKgM2,
            fuel_moisture_fraction: scenario.fuelMoisturePercent / 100
        },
        grid: {
            cell_size_m: 30.0,
            max_cells: 101
        },
        simulation: {
            duration_minutes: 120,
            output_intervals_minutes: [30, 60, 120]
        },
        metadata: {
            source: 'node-api',
            latitude: scenario.latitude,
            longitude: scenario.longitude,
            projected_crs: `EPSG:${projection.epsg}`,
            utm_zone: projection.zone,
            utm_hemisphere: projection.hemisphere,
            observed_at: scenario.observedAt,
            source_fuel_model_id: scenario.fuelModel.id
        }
    };
}

function runPythonModel(modelInput) {
    const projectRoot = path.resolve(__dirname, '../..');
    const candidates = [
        process.env.PYTHON_BIN,
        process.env.PYTHON,
        'python',
        'py',
        process.env.USERPROFILE
            ? path.join(
                process.env.USERPROFILE,
                '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
            )
            : null
    ].filter(Boolean);

    let child;
    let lastError;
    for (const pythonExecutable of candidates) {
        if (path.isAbsolute(pythonExecutable) && !fs.existsSync(pythonExecutable)) {
            continue;
        }

        child = spawnSync(
            pythonExecutable,
            ['-m', 'wildfire_analysis.cli'],
            {
                cwd: projectRoot,
                input: JSON.stringify(modelInput),
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10
            }
        );

        if (!child.error) {
            break;
        }
        lastError = child.error;
        child = null;
    }

    if (!child) {
        throw new Error(`Unable to run Python wildfire model: ${lastError?.message || 'no Python executable found'}`);
    }

    const output = (child.stdout || '').trim();
    if (!output) {
        throw new Error((child.stderr || '').trim() || 'Python wildfire model returned no output');
    }

    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch (error) {
        throw new Error(`Python wildfire model returned invalid JSON: ${output}`);
    }

    if (child.status !== 0 || parsed.status === 'error') {
        throw new Error(parsed.message || (child.stderr || '').trim() || 'Python wildfire model failed');
    }

    return parsed;
}

function runWildfireModel(scenario) {
    const modelInput = buildModelInput(scenario);
    const modelOutput = runPythonModel(modelInput);
    const projection = {
        epsg: modelInput.metadata.projected_crs.replace('EPSG:', ''),
        zone: modelInput.metadata.utm_zone,
        hemisphere: modelInput.metadata.utm_hemisphere
    };
    projection.epsg = Number(projection.epsg);
    const modelOutputGeoJson = modelOutputToGeoJson(modelOutput, projection);

    return {
        modelInput,
        modelOutput,
        modelOutputGeoJson
    };
}

module.exports = {
    buildModelInput,
    runWildfireModel
};
