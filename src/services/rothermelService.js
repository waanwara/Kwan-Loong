const {
    findFuelModelById,
    listFuelModels: listFuelModelsFromDb,
    saveFireScenario
} = require('../db');
const { runWildfireModel } = require('./wildfireModelAdapter');
const { getEnvironmentForLocation } = require('./environmentService');

function toNumber(value, fieldName, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${fieldName} must be a number between ${min} and ${max}`);
    }

    return number;
}

function listFuelModels() {
    return listFuelModelsFromDb();
}

function getFuelModel(fuelModelId) {
    return findFuelModelById(fuelModelId);
}

function normalizeScenario(input) {
    const fuelModelId = String(input.fuelModelId || '').trim();
    const fuelModel = getFuelModel(fuelModelId);
    if (!fuelModel) {
        throw new Error('fuelModelId is not supported');
    }

    return {
        fuelModel,
        windSpeedKmh: toNumber(input.windSpeedKmh, 'windSpeedKmh', { min: 0, max: 150 }),
        windDirectionDeg: input.windDirectionDeg === undefined ? 270 : toNumber(input.windDirectionDeg, 'windDirectionDeg', { min: 0, max: 359.999 }),
        slopePercent: toNumber(input.slopePercent, 'slopePercent', { min: 0, max: 100 }),
        aspectDeg: input.aspectDeg === undefined ? 0 : toNumber(input.aspectDeg, 'aspectDeg', { min: 0, max: 359.999 }),
        fuelMoisturePercent: toNumber(input.fuelMoisturePercent, 'fuelMoisturePercent', { min: 1, max: 60 }),
        temperatureC: input.temperatureC === undefined ? 30 : toNumber(input.temperatureC, 'temperatureC', { min: -20, max: 65 }),
        relativeHumidityFraction: input.relativeHumidityFraction === undefined ? 0.5 : toNumber(input.relativeHumidityFraction, 'relativeHumidityFraction', { min: 0, max: 1 }),
        rainfallMmDay: input.rainfallMmDay === undefined ? 0 : toNumber(input.rainfallMmDay, 'rainfallMmDay', { min: 0, max: 500 }),
        elevationM: input.elevationM === undefined ? 0 : toNumber(input.elevationM, 'elevationM', { min: -500, max: 9000 }),
        latitude: input.latitude === undefined ? null : toNumber(input.latitude, 'latitude', { min: -90, max: 90 }),
        longitude: input.longitude === undefined ? null : toNumber(input.longitude, 'longitude', { min: -180, max: 180 }),
        observedAt: input.observedAt || new Date().toISOString()
    };
}

function estimateFlameLength(modelOutput, fuelLoadKgM2) {
    const ros = modelOutput.summary.rate_of_spread_m_min;
    return Math.sqrt(ros * fuelLoadKgM2) * 1.3;
}

function estimateFireBehavior(input, context = {}) {
    const scenario = normalizeScenario(input);
    const { modelInput, modelOutput, modelOutputGeoJson } = runWildfireModel(scenario);

    const spreadRateMMin = modelOutput.summary.rate_of_spread_m_min;
    const flameLengthM = estimateFlameLength(modelOutput, scenario.fuelModel.typicalFuelLoadKgM2);
    const arrivalCellCount = modelOutput.arrival_time_grid?.cells?.length || 0;

    const result = {
        scenario,
        estimate: {
            spreadRateMMin: Number(spreadRateMMin.toFixed(2)),
            flameLengthM: Number(flameLengthM.toFixed(2)),
            riskIndex: Number(Math.min(100, spreadRateMMin * 8 + flameLengthM * 10).toFixed(1)),
            spreadDirectionDeg: modelOutput.summary.spread_direction_deg,
            arrivalCellCount
        },
        modelStatus: modelOutput.model_version,
        modelInput,
        modelOutput,
        modelOutputGeoJson,
        notes: [
            'Uses wildfire_analysis simulate_fire() through the Node API bridge.',
            'Current model is a Rothermel-inspired MVP baseline, not a validated operational Rothermel implementation.',
            'Frontend lat/lon are projected to UTM metres before simulation, then model output is converted back to GeoJSON.'
        ]
    };

    if (context.persist !== false) {
        result.scenarioId = Number(saveFireScenario({
            createdBy: context.userId || null,
            scenario: {
                ...scenario,
                modelInput
            },
            estimate: {
                ...result.estimate,
                modelVersion: result.modelStatus
            }
        }));
    }

    return result;
}

async function estimateFireBehaviorWithEnvironment(input, context = {}) {
    const environment = await getEnvironmentForLocation({
        latitude: input.latitude,
        longitude: input.longitude,
        preferCsv: input.preferCsv === true
    });

    const enrichedInput = {
        ...input,
        fuelModelId: input.fuelModelId || environment.fuel.fuelModelId,
        windSpeedKmh: input.windSpeedKmh ?? environment.wind.windSpeedKmh,
        windDirectionDeg: input.windDirectionDeg ?? environment.wind.windDirectionDeg,
        slopePercent: input.slopePercent ?? environment.defaults.slopePercent,
        fuelMoisturePercent: input.fuelMoisturePercent ?? environment.defaults.fuelMoisturePercent,
        temperatureC: input.temperatureC ?? environment.defaults.temperatureC,
        relativeHumidityFraction: input.relativeHumidityFraction ?? environment.defaults.relativeHumidityFraction,
        rainfallMmDay: input.rainfallMmDay ?? environment.defaults.rainfallMmDay,
        elevationM: input.elevationM ?? environment.defaults.elevationM
    };

    const result = estimateFireBehavior(enrichedInput, context);
    return {
        ...result,
        environment
    };
}

async function estimateFireBehaviorFromHotspot(input, context = {}) {
    const hotspot = input.hotspot || input;
    const latitude = toNumber(hotspot.latitude, 'hotspot.latitude', { min: -90, max: 90 });
    const longitude = toNumber(hotspot.longitude, 'hotspot.longitude', { min: -180, max: 180 });

    const baseInput = {
        fuelModelId: input.fuelModelId || 'SH2',
        windSpeedKmh: input.windSpeedKmh,
        windDirectionDeg: input.windDirectionDeg,
        slopePercent: input.slopePercent,
        aspectDeg: input.aspectDeg ?? 0,
        fuelMoisturePercent: input.fuelMoisturePercent,
        temperatureC: input.temperatureC,
        relativeHumidityFraction: input.relativeHumidityFraction,
        rainfallMmDay: input.rainfallMmDay,
        elevationM: input.elevationM,
        latitude,
        longitude,
        observedAt: hotspot.acquisitionDate && hotspot.acquisitionTime
            ? `${hotspot.acquisitionDate}T${String(hotspot.acquisitionTime).padStart(4, '0')}`
            : undefined
    };

    if (input.useLiveEnvironment !== false) {
        return estimateFireBehaviorWithEnvironment(baseInput, context);
    }

    return estimateFireBehavior({
        ...baseInput,
        windSpeedKmh: baseInput.windSpeedKmh ?? 18,
        windDirectionDeg: baseInput.windDirectionDeg ?? 270,
        slopePercent: baseInput.slopePercent ?? 12,
        fuelMoisturePercent: baseInput.fuelMoisturePercent ?? 9,
        temperatureC: baseInput.temperatureC ?? 30,
        relativeHumidityFraction: baseInput.relativeHumidityFraction ?? 0.5,
        rainfallMmDay: baseInput.rainfallMmDay ?? 0,
        elevationM: baseInput.elevationM ?? 0
    }, context);
}

module.exports = {
    estimateFireBehavior,
    estimateFireBehaviorFromHotspot,
    estimateFireBehaviorWithEnvironment,
    getFuelModel,
    listFuelModels
};
