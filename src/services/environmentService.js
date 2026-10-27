const fs = require('fs');
const { getNcmWeatherForLocation } = require('./ncmWeatherService');
const { getNearestWindObservation } = require('./windService');
const { getNearestPm25Observation } = require('./pm25Service');
const { fetchAvgTreeCoverFromGfw, isGfwConfigured } = require('./forestService');

const DEFAULT_FOREST_CSV_PATH = process.env.FOREST_CSV_PATH || 'laos_forest.csv';

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && next === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current);
    return values;
}

function parseCsvRecords(csv) {
    const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];

    const headers = parseCsvLine(lines[0]).map((header) => header.trim().replace(/^\uFEFF/, ''));
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        return headers.reduce((record, header, index) => {
            record[header] = values[index];
            return record;
        }, {});
    });
}

function nearestPoint(points, latitude, longitude) {
    if (!points.length) return null;

    return points.reduce((nearest, point) => {
        const distanceSq = (point.latitude - latitude) ** 2 + (point.longitude - longitude) ** 2;
        if (!nearest || distanceSq < nearest.distanceSq) {
            return { point, distanceSq };
        }
        return nearest;
    }, null).point;
}

function mapTreeCoverToFuelModel(treeCoverPct) {
    if (treeCoverPct === null || treeCoverPct === undefined) {
        return {
            fuelModelId: 'SH2',
            confidence: 'fallback',
            reason: 'No local tree-cover sample is available yet.'
        };
    }

    if (treeCoverPct >= 60) {
        return {
            fuelModelId: 'TU5',
            confidence: 'tree-cover-heuristic',
            reason: 'High tree cover suggests timber understory surface fuel.'
        };
    }

    if (treeCoverPct <= 25) {
        return {
            fuelModelId: 'GR1',
            confidence: 'tree-cover-heuristic',
            reason: 'Low tree cover suggests grass or sparse surface fuel.'
        };
    }

    return {
        fuelModelId: 'SH2',
        confidence: 'tree-cover-heuristic',
        reason: 'Moderate tree cover is mapped to shrub/mixed surface fuel for the MVP.'
    };
}

function getNearestForestSample({ latitude, longitude, path = DEFAULT_FOREST_CSV_PATH } = {}) {
    if (!fs.existsSync(path)) return null;

    const points = parseCsvRecords(fs.readFileSync(path, 'utf8')).map((row) => ({
        latitude: toNumber(row.latitude),
        longitude: toNumber(row.longitude),
        treeCoverPct: toNumber(row.tree_cover_pct)
    })).filter((point) => (
        point.latitude !== null
        && point.longitude !== null
    ));

    return nearestPoint(points, Number(latitude), Number(longitude));
}

async function getEnvironmentForLocation({ latitude, longitude, preferCsv = false } = {}) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat === null || lng === null) {
        throw new Error('latitude and longitude are required');
    }

    let weather = null;
    let wind = null;
    try {
        weather = await getNcmWeatherForLocation({ latitude: lat, longitude: lng });
        wind = {
            latitude: lat,
            longitude: lng,
            windSpeedKmh: weather.windSpeedKmh,
            windSpeedMs: weather.windSpeedMs,
            windDirectionDeg: weather.windDirectionDeg,
            source: 'ncm',
            mode: 'api',
            requested: { latitude: lat, longitude: lng }
        };
    } catch {
        wind = await getNearestWindObservation({ latitude: lat, longitude: lng, preferCsv });
    }

    // PM2.5 is informational for the operator - it never feeds the spread
    // model - so a failure here must not take down the whole environment
    // lookup the way a missing wind reading would.
    let airQuality = null;
    try {
        airQuality = await getNearestPm25Observation({ latitude: lat, longitude: lng, preferCsv });
    } catch {
        airQuality = null;
    }

    let forest = getNearestForestSample({ latitude: lat, longitude: lng });

    if (!forest && isGfwConfigured()) {
        try {
            const treeCoverPct = await fetchAvgTreeCoverFromGfw(lat, lng);
            if (Number.isFinite(treeCoverPct)) {
                forest = { latitude: lat, longitude: lng, treeCoverPct, source: 'gfw_live' };
            }
        } catch {
            // GFW is best-effort here - fall through to the tree-cover-less
            // fuel model fallback rather than failing the whole environment call.
        }
    }

    const fuel = mapTreeCoverToFuelModel(forest?.treeCoverPct);

    return {
        requested: { latitude: lat, longitude: lng },
        observedAt: new Date().toISOString(),
        wind,
        weather,
        airQuality,
        forest: forest ? {
            latitude: forest.latitude,
            longitude: forest.longitude,
            treeCoverPct: forest.treeCoverPct,
            source: forest.source || 'local_csv'
        } : null,
        fuel,
        defaults: {
            slopePercent: 12,
            fuelMoisturePercent: 9,
            temperatureC: weather?.temperatureC ?? 30,
            relativeHumidityFraction: weather?.relativeHumidityFraction ?? 0.5,
            rainfallMmDay: weather?.rainfallMmDay ?? 0,
            elevationM: 0
        },
        notes: [
            weather
                ? 'Weather is loaded from NCM via configured backend URL template.'
                : 'Wind is nearest-grid-point data from AQ Tracker, with local CSV fallback when available.',
            forest?.source === 'gfw_live'
                ? 'Tree cover is a live Global Forest Watch (umd_tree_cover_density_2000) query for this point.'
                : forest?.source === 'local_csv'
                    ? 'Tree cover is from the nearest point in the local forest CSV sample.'
                    : 'No tree-cover data was available for this point (no local CSV sample and GFW is unconfigured or failed); using the SH2 default fuel model.',
            'Fuel model is an MVP tree-cover heuristic, not a full Rothermel fuel-bed classification.',
            airQuality
                ? `PM2.5 is the nearest AQ Tracker grid point (${airQuality.source}); it is reported for situational awareness and is not an input to the spread model.`
                : 'PM2.5 was unavailable for this point; wind and fuel are unaffected.'
        ]
    };
}

module.exports = {
    getEnvironmentForLocation,
    getNearestForestSample,
    mapTreeCoverToFuelModel
};
