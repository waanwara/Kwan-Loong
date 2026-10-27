/**
 * PM2.5 point lookup from the ADPC SERVIR SEA THREDDS server.
 *
 * Source: https://mappool.adpc.net/thredds/catalog/ServirData/geos5km/catalog.html
 * The server publishes one NetCDF file per day named YYYYMMDD.nc, holding a
 * GEOS 5km air-quality forecast on a 800x800 lat/lon grid covering SE Asia
 * (lat -11.35..28.60, lon 91.75..141.6875) at 3-hourly steps.
 *
 * We read point values through the NetCDF Subset Service ("grid as point"),
 * which accepts a lat/lon and returns a one-row CSV. The plain grid NCSS
 * endpoint only emits NetCDF, which would need a binary parser; the point
 * endpoint gives us a number directly, so that is what we use.
 *
 * Note: src/services/pm25.js is a separate browser-side helper that builds
 * THREDDS *WMS* tile URLs for painting the PM2.5 raster over the Leaflet map.
 * It answers "draw me the plume", not "what is the value here", so the two
 * files are complementary rather than duplicates.
 */
const fs = require('fs');
const { parseCsvRecords } = require('./windService');

const THREDDS_BASE = process.env.PM25_THREDDS_BASE
    || 'https://mappool.adpc.net/thredds';
const DATASET_DIR = process.env.PM25_DATASET_DIR || 'ServirData/geos5km';
const DEFAULT_PM25_CSV_PATH = process.env.PM25_CSV_PATH || 'laos_pm25.csv';

// How many days back to walk when today's file has not been published yet.
// The daily file lands around 10:40 UTC, so any request earlier than that
// must fall back to yesterday - that is the normal case, not an error.
const LOOKBACK_DAYS = Number(process.env.PM25_LOOKBACK_DAYS || 5);

// Preferred variable first. DS_BC_DNN_PM25 is the bias-corrected neural-net
// product; DS_GEOSPM25 is the raw GEOS model field. We fall back to the raw
// field only if the corrected one is missing from a given day's file.
const PM25_VARIABLES = ['DS_BC_DNN_PM25', 'DS_GEOSPM25'];

// THREDDS marks missing cells with this, and it must never reach the UI as a
// concentration - a raw -999 rendered as "good air" would be dangerous.
const FILL_VALUE = -999.0;

const DATASET_TTL_MS = Number(process.env.PM25_DATASET_TTL_MS || 30 * 60 * 1000);
const POINT_TTL_MS = Number(process.env.PM25_POINT_TTL_MS || 30 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.PM25_TIMEOUT_MS || 15000);

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatYyyymmdd(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/**
 * Today first, then each previous day. Dates are computed in UTC because the
 * filenames track the model's UTC run date, not the viewer's local date -
 * using local time in Bangkok (UTC+7) would ask for tomorrow's file for seven
 * hours of every day.
 */
function candidateDatasetDates(now = new Date(), lookbackDays = LOOKBACK_DAYS) {
    const dates = [];
    for (let offset = 0; offset <= lookbackDays; offset += 1) {
        const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
        dates.push(formatYyyymmdd(date));
    }
    return dates;
}

function datasetXmlUrl(yyyymmdd) {
    return `${THREDDS_BASE}/ncss/grid/${DATASET_DIR}/${yyyymmdd}.nc/dataset.xml`;
}

function pointQueryUrl(yyyymmdd, variable, latitude, longitude) {
    const params = new URLSearchParams({
        var: variable,
        latitude: String(latitude),
        longitude: String(longitude),
        accept: 'csv',
        time: 'present'
    });
    return `${THREDDS_BASE}/ncss/grid/${DATASET_DIR}/${yyyymmdd}.nc?${params}`;
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { 'User-Agent': 'Kwan-Long/0.2', ...(options.headers || {}) }
        });
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Dataset resolution (today, else the most recent previous day)
// ---------------------------------------------------------------------------

let datasetCache = null; // { date, variable, resolvedAt }
let datasetInFlight = null;

/**
 * Reads a day's dataset.xml and reports which PM2.5 variable it actually
 * carries. Returning the variable here (rather than assuming it) means a day
 * where ADPC ships only the raw GEOS field still works.
 */
async function describeDataset(yyyymmdd) {
    const response = await fetchWithTimeout(datasetXmlUrl(yyyymmdd));
    if (!response.ok) return null;

    const xml = await response.text();
    const variable = PM25_VARIABLES.find((name) => xml.includes(`name="${name}"`));
    if (!variable) return null;

    return { date: yyyymmdd, variable };
}

async function resolveDataset({ force = false } = {}) {
    const now = Date.now();
    if (!force && datasetCache && (now - datasetCache.resolvedAt) < DATASET_TTL_MS) {
        return datasetCache;
    }
    if (datasetInFlight) return datasetInFlight;

    datasetInFlight = (async () => {
        try {
            const tried = [];
            for (const date of candidateDatasetDates()) {
                tried.push(date);
                let described = null;
                try {
                    described = await describeDataset(date);
                } catch {
                    // Network blip on one day shouldn't abort the walk-back.
                    described = null;
                }
                if (described) {
                    datasetCache = { ...described, resolvedAt: Date.now() };
                    return datasetCache;
                }
            }
            throw new Error(
                `No PM2.5 dataset found on THREDDS for the last ${LOOKBACK_DAYS + 1} days (tried ${tried.join(', ')})`
            );
        } finally {
            datasetInFlight = null;
        }
    })();

    return datasetInFlight;
}

// ---------------------------------------------------------------------------
// CSV response parsing
// ---------------------------------------------------------------------------

/**
 * NCSS point CSV looks like:
 *   date,lat[unit="degrees_north"],lon[unit="degrees_east"],DS_BC_DNN_PM25[unit="ug m-3"]
 *   2026-09-16T13:30:00Z,17.95000,102.62500,42.1
 * Column order and the presence of the [unit=...] suffix vary between TDS
 * versions, so match on the name before the bracket rather than by position.
 */
function parseNcssPointCsv(csv, variable) {
    const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
        throw new Error('PM2.5 point response was empty');
    }

    const rawHeaders = lines[0].split(',').map((header) => header.trim());
    const baseNames = rawHeaders.map((header) => header.split('[')[0].trim().toLowerCase());
    const values = lines[1].split(',').map((value) => value.trim());

    const valueIndex = baseNames.indexOf(variable.toLowerCase());
    if (valueIndex === -1) {
        throw new Error(`PM2.5 response has no ${variable} column (got: ${rawHeaders.join(', ')})`);
    }

    const findIndex = (...names) => baseNames.findIndex((name) => names.includes(name));
    const timeIndex = findIndex('date', 'time');
    const latIndex = findIndex('lat', 'latitude');
    const lonIndex = findIndex('lon', 'longitude');

    // Pull the declared unit so a future switch to kg m-3 is caught rather
    // than silently rendering a number a billion times too small.
    const unitMatch = /unit="([^"]+)"/.exec(rawHeaders[valueIndex] || '');

    return {
        value: toNumber(values[valueIndex]),
        unit: unitMatch ? unitMatch[1] : null,
        validTime: timeIndex === -1 ? null : values[timeIndex],
        latitude: latIndex === -1 ? null : toNumber(values[latIndex]),
        longitude: lonIndex === -1 ? null : toNumber(values[lonIndex])
    };
}

/**
 * Normalises whatever mass-concentration unit THREDDS declares into ug/m3.
 * Unknown or absent units are treated as ug/m3, which is what this product
 * has always served.
 */
function toMicrogramsPerM3(value, unit) {
    if (!Number.isFinite(value)) return null;
    const normalised = String(unit || '').toLowerCase().replace(/[\s^]/g, '');

    if (/^kgm-?3$/.test(normalised) || normalised === 'kg/m3') return value * 1e9;
    if (/^mgm-?3$/.test(normalised) || normalised === 'mg/m3') return value * 1e3;
    return value;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Thai PCD / US EPA-aligned PM2.5 bands (24-hour, ug/m3). `key` is stable for
 * the frontend to colour against; `label` is English fallback text only - the
 * UI translates through its own i18n dictionary.
 */
const PM25_BANDS = [
    { key: 'good', max: 15, label: 'Good' },
    { key: 'moderate', max: 25, label: 'Moderate' },
    { key: 'unhealthy_sensitive', max: 37.5, label: 'Unhealthy for sensitive groups' },
    { key: 'unhealthy', max: 75, label: 'Unhealthy' },
    { key: 'hazardous', max: Infinity, label: 'Hazardous' }
];

function categorisePm25(value) {
    if (!Number.isFinite(value)) return { key: 'unknown', label: 'Unknown' };
    const band = PM25_BANDS.find((candidate) => value <= candidate.max);
    return { key: band.key, label: band.label };
}

// ---------------------------------------------------------------------------
// Point lookup
// ---------------------------------------------------------------------------

// The Strategic tab requests 22 provinces and re-requests them on refresh, so
// memoise each coordinate for the life of a model step. The underlying data is
// 3-hourly; a 30-minute TTL costs no freshness.
const pointCache = new Map(); // key -> { result, fetchedAt }

function cacheKey(dataset, variable, lat, lng) {
    return `${dataset}:${variable}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

async function fetchPm25Point(dataset, variable, lat, lng) {
    const url = pointQueryUrl(dataset, variable, lat, lng);
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        throw new Error(`THREDDS PM2.5 request failed (${response.status})`);
    }

    const parsed = parseNcssPointCsv(await response.text(), variable);

    if (parsed.value === null || parsed.value === FILL_VALUE || parsed.value <= FILL_VALUE + 1) {
        throw new Error('PM2.5 is masked or missing at this location');
    }

    const micrograms = toMicrogramsPerM3(parsed.value, parsed.unit);
    if (!Number.isFinite(micrograms) || micrograms < 0) {
        throw new Error('PM2.5 value was not a usable concentration');
    }

    return { ...parsed, micrograms };
}

/**
 * Optional offline fallback mirroring the laos_wind.csv pattern. Expects
 * latitude,longitude,pm25 columns (pm2_5 / pm25_ugm3 also accepted).
 */
function readPm25PointsFromCsv(path = DEFAULT_PM25_CSV_PATH) {
    if (!fs.existsSync(path)) return null;

    const points = parseCsvRecords(fs.readFileSync(path, 'utf8')).map((row) => ({
        latitude: toNumber(row.latitude),
        longitude: toNumber(row.longitude),
        value: toNumber(row.pm25 ?? row.pm2_5 ?? row.pm25_ugm3)
    })).filter((point) => (
        point.latitude !== null && point.longitude !== null && point.value !== null
    ));

    return points.length ? points : null;
}

function nearestCsvPoint(points, latitude, longitude) {
    return points.reduce((nearest, point) => {
        const distanceSq = (point.latitude - latitude) ** 2 + (point.longitude - longitude) ** 2;
        if (!nearest || distanceSq < nearest.distanceSq) return { point, distanceSq };
        return nearest;
    }, null).point;
}

function buildResult({ pm25, latitude, longitude, dataset, variable, validTime, source, mode, requested }) {
    const rounded = Number(pm25.toFixed(1));
    const today = formatYyyymmdd(new Date());

    return {
        latitude,
        longitude,
        pm25: rounded,
        unit: 'ug/m3',
        category: categorisePm25(rounded),
        source,
        mode,
        dataset,
        // Surfaced so the UI can say "this is yesterday's run" instead of
        // presenting stale model output as current conditions.
        datasetIsToday: dataset === today,
        variable,
        validTime,
        requested
    };
}

async function getNearestPm25Observation({ latitude, longitude, preferCsv = false } = {}) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat === null || lng === null) {
        throw new Error('latitude and longitude are required for PM2.5 lookup');
    }

    const requested = { latitude: lat, longitude: lng };

    const fromCsv = (mode) => {
        const points = readPm25PointsFromCsv();
        if (!points) return null;
        const nearest = nearestCsvPoint(points, lat, lng);
        return buildResult({
            pm25: nearest.value,
            latitude: nearest.latitude,
            longitude: nearest.longitude,
            dataset: 'local_csv',
            variable: null,
            validTime: null,
            source: 'local_csv',
            mode,
            requested
        });
    };

    if (preferCsv) {
        const csvResult = fromCsv('csv');
        if (csvResult) return csvResult;
    }

    try {
        const { date, variable } = await resolveDataset();
        const key = cacheKey(date, variable, lat, lng);
        const cached = pointCache.get(key);
        if (cached && (Date.now() - cached.fetchedAt) < POINT_TTL_MS) {
            return cached.result;
        }

        const point = await fetchPm25Point(date, variable, lat, lng);
        const result = buildResult({
            pm25: point.micrograms,
            latitude: point.latitude ?? lat,
            longitude: point.longitude ?? lng,
            dataset: date,
            variable,
            validTime: point.validTime,
            source: 'adpc_thredds',
            mode: 'api',
            requested
        });

        pointCache.set(key, { result, fetchedAt: Date.now() });
        return result;
    } catch (error) {
        const csvResult = fromCsv('csv_fallback');
        if (csvResult) return csvResult;
        throw error;
    }
}

module.exports = {
    getNearestPm25Observation,
    categorisePm25,
    candidateDatasetDates,
    parseNcssPointCsv,
    toMicrogramsPerM3,
    pointQueryUrl,
    resolveDataset,
    PM25_BANDS,
    PM25_VARIABLES
};
