const { listFirebreakPlans, saveFirebreakPlan } = require('../db');

function toNumber(value, fieldName, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${fieldName} must be a number between ${min} and ${max}`);
    }
    return number;
}

function distanceKm(a, b) {
    const earthRadiusKm = 6371;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function lineLengthKm(coordinates) {
    let total = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        total += distanceKm(coordinates[i - 1], coordinates[i]);
    }
    return Number(total.toFixed(3));
}

function normalizeLineGeometry(input) {
    const coordinates = input.coordinates || [
        [
            toNumber(input.startLng, 'startLng', { min: -180, max: 180 }),
            toNumber(input.startLat, 'startLat', { min: -90, max: 90 })
        ],
        [
            toNumber(input.endLng, 'endLng', { min: -180, max: 180 }),
            toNumber(input.endLat, 'endLat', { min: -90, max: 90 })
        ]
    ];

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('firebreak geometry must have at least two coordinates');
    }

    const normalized = coordinates.map((coordinate, index) => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) {
            throw new Error(`coordinate ${index} must be [longitude, latitude]`);
        }
        return [
            toNumber(coordinate[0], `coordinate ${index} longitude`, { min: -180, max: 180 }),
            toNumber(coordinate[1], `coordinate ${index} latitude`, { min: -90, max: 90 })
        ];
    });

    return {
        type: 'LineString',
        coordinates: normalized
    };
}

function createFirebreakPlan(input, context = {}) {
    const geometry = normalizeLineGeometry(input.geometry || input);
    const name = String(input.name || 'Firebreak plan').trim();
    if (!name) {
        throw new Error('name is required');
    }

    return saveFirebreakPlan({
        name,
        status: input.status || 'planned',
        geometry,
        lengthKm: input.lengthKm === undefined ? lineLengthKm(geometry.coordinates) : toNumber(input.lengthKm, 'lengthKm', { min: 0 }),
        priority: input.priority || 'medium',
        source: input.source || 'operator',
        notes: input.notes,
        createdBy: context.userId || null
    });
}

function getFirebreakPlansGeoJson() {
    const plans = listFirebreakPlans();
    return {
        type: 'FeatureCollection',
        features: plans.map((plan) => ({
            type: 'Feature',
            properties: {
                id: plan.id,
                name: plan.name,
                status: plan.status,
                lengthKm: plan.lengthKm,
                priority: plan.priority,
                source: plan.source,
                notes: plan.notes,
                createdAt: plan.createdAt,
                updatedAt: plan.updatedAt
            },
            geometry: plan.geometry
        }))
    };
}

module.exports = {
    createFirebreakPlan,
    getFirebreakPlansGeoJson,
    lineLengthKm,
    normalizeLineGeometry
};
