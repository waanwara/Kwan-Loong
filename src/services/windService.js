const fs = require('fs');

const DEFAULT_WIND_API_URL = process.env.WIND_API_URL || 'https://aq-tracker-servir.adpc.net/latest/';
const DEFAULT_WIND_CSV_PATH = process.env.WIND_CSV_PATH || 'laos_wind.csv';

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

function windToDirectionFromDeg(u, v) {
    const directionTo = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    return (directionTo + 180) % 360;
}

function normalizeWindDirectionFromCsv(value, convention = process.env.WIND_CSV_DIRECTION_CONVENTION || 'to') {
    const direction = toNumber(value);
    if (direction === null) return null;
    return convention === 'from' ? direction : (direction + 180) % 360;
}

function parseWindCsv(csv, options = {}) {
    return parseCsvRecords(csv).map((row) => {
        const latitude = toNumber(row.latitude);
        const longitude = toNumber(row.longitude);
        const windSpeedMs = toNumber(row.wind_speed);
        const windDirectionFromDeg = normalizeWindDirectionFromCsv(row.wind_direction, options.directionConvention);

        return {
            latitude,
            longitude,
            windSpeedMs,
            windSpeedKmh: windSpeedMs === null ? null : windSpeedMs * 3.6,
            windDirectionDeg: windDirectionFromDeg,
            u: toNumber(row.u),
            v: toNumber(row.v),
            source: 'local_csv'
        };
    }).filter((point) => (
        point.latitude !== null
        && point.longitude !== null
        && point.windSpeedMs !== null
        && point.windDirectionDeg !== null
    ));
}

/**
 * Reads the grid geometry shared by every record in an AQ Tracker payload.
 * Each record carries the same grib2-style header shape: nx/ny cell counts,
 * lo1/la1 as the top-left corner, and dx/dy as the cell size in degrees.
 */
function readGridHeader(header, label = 'AQ Tracker') {
    const nx = Number(header?.nx);
    const ny = Number(header?.ny);
    const lonStart = Number(header?.lo1);
    const latStart = Number(header?.la1);
    const dx = Number(header?.dx);
    const dy = Number(header?.dy);

    if (![nx, ny, lonStart, latStart, dx, dy].every(Number.isFinite)) {
        throw new Error(`${label} grid header is invalid`);
    }

    return { nx, ny, lonStart, latStart, dx, dy };
}

/**
 * Walks a single scalar AQ Tracker record into {latitude, longitude, value}
 * points. Wind needs two records combined (U and V), but every other
 * parameter in the payload - PM2.5 included - is a plain scalar field, so
 * this is the shared decoder for those.
 */
function decodeAqTrackerGrid(record, label = 'AQ Tracker') {
    const { nx, ny, lonStart, latStart, dx, dy } = readGridHeader(record?.header, label);
    const data = record?.data;
    if (!Array.isArray(data)) {
        throw new Error(`${label} record has no data array`);
    }

    const points = [];
    for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
            const value = toNumber(data[y * nx + x]);
            if (value === null) continue;
            points.push({
                latitude: latStart - y * dy,
                longitude: lonStart + x * dx,
                value
            });
        }
    }

    return points;
}

function parseAqTrackerWind(records) {
    const uRecord = records.find((record) => record?.header?.parameterNumberName === 'U-component_of_wind');
    const vRecord = records.find((record) => record?.header?.parameterNumberName === 'V-component_of_wind');
    if (!uRecord || !vRecord) {
        throw new Error('AQ Tracker response does not include U/V wind components');
    }

    const { nx, ny, lonStart, latStart, dx, dy } = readGridHeader(uRecord.header, 'AQ Tracker wind');

    const points = [];
    for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
            const index = y * nx + x;
            const u = toNumber(uRecord.data[index]);
            const v = toNumber(vRecord.data[index]);
            if (u === null || v === null) continue;

            const latitude = latStart - y * dy;
            const longitude = lonStart + x * dx;
            const windSpeedMs = Math.sqrt(u ** 2 + v ** 2);
            points.push({
                latitude,
                longitude,
                u,
                v,
                windSpeedMs,
                windSpeedKmh: windSpeedMs * 3.6,
                windDirectionDeg: windToDirectionFromDeg(u, v),
                source: 'aq_tracker'
            });
        }
    }

    return points;
}

const LAOS_WIND_BOUNDS = {
    west: Number(process.env.WIND_BOUNDS_WEST || 100.0),
    east: Number(process.env.WIND_BOUNDS_EAST || 107.8),
    south: Number(process.env.WIND_BOUNDS_SOUTH || 13.8),
    north: Number(process.env.WIND_BOUNDS_NORTH || 22.7)
};

function cropIndicesForBounds({ nx, ny, lonStart, latStart, dx, dy }, bounds) {
    let xStart = Math.floor((bounds.west - lonStart) / dx);
    let xEnd = Math.ceil((bounds.east - lonStart) / dx);
    xStart = Math.max(0, Math.min(nx - 1, xStart));
    xEnd = Math.max(0, Math.min(nx - 1, xEnd));

    let yStart = Math.floor((latStart - bounds.north) / dy);
    let yEnd = Math.ceil((latStart - bounds.south) / dy);
    yStart = Math.max(0, Math.min(ny - 1, yStart));
    yEnd = Math.max(0, Math.min(ny - 1, yEnd));

    if (xEnd < xStart || yEnd < yStart) {
        throw new Error('Wind grid does not overlap the configured Laos bounds');
    }

    return { xStart, xEnd, yStart, yEnd };
}

function extractSubgrid(data, nx, { xStart, xEnd, yStart, yEnd }) {
    const newNx = xEnd - xStart + 1;
    const newNy = yEnd - yStart + 1;
    const cropped = new Array(newNx * newNy);

    for (let y = yStart; y <= yEnd; y += 1) {
        for (let x = xStart; x <= xEnd; x += 1) {
            cropped[(y - yStart) * newNx + (x - xStart)] = data[y * nx + x];
        }
    }

    return { data: cropped, nx: newNx, ny: newNy };
}

function toVelocityRecord(record, parameterNumber, parameterNumberName, bounds) {
    const geometry = readGridHeader(record?.header, 'AQ Tracker wind');
    if (!Array.isArray(record?.data)) {
        throw new Error('AQ Tracker wind record has no data array');
    }

    const crop = cropIndicesForBounds(geometry, bounds);
    const { data: croppedData, nx, ny } = extractSubgrid(record.data, geometry.nx, crop);
    const lo1 = geometry.lonStart + crop.xStart * geometry.dx;
    const la1 = geometry.latStart - crop.yStart * geometry.dy;

    return {
        header: {
            ...record.header,
            parameterCategory: 2,
            parameterNumber,
            parameterNumberName,
            parameterUnit: 'm.s-1',
            nx,
            ny,
            lo1,
            la1,
            lo2: lo1 + (nx - 1) * geometry.dx,
            la2: la1 - (ny - 1) * geometry.dy,
            dx: geometry.dx,
            dy: geometry.dy,
            refTime: record.header.refTime || new Date().toISOString(),
            forecastTime: record.header.forecastTime ?? 0
        },
        data: croppedData.map((value) => toNumber(value) ?? 0)
    };
}

async function getWindVelocityGrid({ force = false, bounds = LAOS_WIND_BOUNDS } = {}) {
    const records = await fetchAqTrackerRecords({ force });
    const uRecord = records.find((record) => record?.header?.parameterNumberName === 'U-component_of_wind');
    const vRecord = records.find((record) => record?.header?.parameterNumberName === 'V-component_of_wind');
    if (!uRecord || !vRecord) {
        throw new Error('AQ Tracker response does not include U/V wind components');
    }

    const u = toVelocityRecord(uRecord, 2, 'eastward_wind', bounds);
    const v = toVelocityRecord(vRecord, 3, 'northward_wind', bounds);
    let maxSpeedMs = 0;
    for (let i = 0; i < u.data.length; i += 1) {
        const speed = Math.sqrt(u.data[i] ** 2 + (v.data[i] ?? 0) ** 2);
        if (speed > maxSpeedMs) maxSpeedMs = speed;
    }

    return {
        source: 'aq_tracker',
        observedAt: u.header.refTime,
        bounds,
        grid: {
            nx: u.header.nx,
            ny: u.header.ny,
            lo1: u.header.lo1,
            la1: u.header.la1,
            lo2: u.header.lo2,
            la2: u.header.la2,
            dx: u.header.dx,
            dy: u.header.dy
        },
        maxSpeedMs: Number(maxSpeedMs.toFixed(2)),
        records: [u, v]
    };
}

function nearestPoint(points, latitude, longitude) {
    if (!points.length) {
        throw new Error('No wind observations are available');
    }

    return points.reduce((nearest, point) => {
        const distanceSq = (point.latitude - latitude) ** 2 + (point.longitude - longitude) ** 2;
        if (!nearest || distanceSq < nearest.distanceSq) {
            return { point, distanceSq };
        }
        return nearest;
    }, null).point;
}

// The AQ Tracker payload is a full multi-parameter grid and is the same
// document for wind and for PM2.5. The Strategic tab asks for 22 provinces at
// once, so without a cache we would download that grid 22 times per refresh
// (and again for PM2.5). The upstream product only publishes a new "latest"
// frame periodically, so a short TTL costs us no freshness.
const AQ_TRACKER_TTL_MS = Number(process.env.AQ_TRACKER_TTL_MS || 5 * 60 * 1000);
let aqTrackerCache = null; // { records, fetchedAt }
let aqTrackerInFlight = null;

async function fetchAqTrackerRecords({ force = false } = {}) {
    const now = Date.now();
    if (!force && aqTrackerCache && (now - aqTrackerCache.fetchedAt) < AQ_TRACKER_TTL_MS) {
        return aqTrackerCache.records;
    }

    // Collapse concurrent callers onto a single request.
    if (aqTrackerInFlight) return aqTrackerInFlight;

    aqTrackerInFlight = (async () => {
        try {
            const response = await fetch(DEFAULT_WIND_API_URL, {
                headers: { 'User-Agent': 'Kwan-Long/0.2' }
            });
            if (!response.ok) {
                throw new Error(`AQ Tracker request failed (${response.status})`);
            }
            const records = await response.json();
            if (!Array.isArray(records)) {
                throw new Error('AQ Tracker response was not a record array');
            }
            aqTrackerCache = { records, fetchedAt: Date.now() };
            return records;
        } finally {
            aqTrackerInFlight = null;
        }
    })();

    return aqTrackerInFlight;
}

async function fetchWindPointsFromApi() {
    return parseAqTrackerWind(await fetchAqTrackerRecords());
}

function readWindPointsFromCsv(path = DEFAULT_WIND_CSV_PATH) {
    if (!fs.existsSync(path)) return [];
    return parseWindCsv(fs.readFileSync(path, 'utf8'));
}

async function getNearestWindObservation({ latitude, longitude, preferCsv = false } = {}) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat === null || lng === null) {
        throw new Error('latitude and longitude are required for wind lookup');
    }

    let points = [];
    let mode = 'api';

    if (preferCsv) {
        points = readWindPointsFromCsv();
        mode = points.length ? 'csv' : 'api';
    }

    if (!points.length) {
        try {
            points = await fetchWindPointsFromApi();
        } catch (error) {
            const csvPoints = readWindPointsFromCsv();
            if (!csvPoints.length) throw error;
            points = csvPoints;
            mode = 'csv_fallback';
        }
    }

    const nearest = nearestPoint(points, lat, lng);
    return {
        ...nearest,
        windSpeedKmh: Number(nearest.windSpeedKmh.toFixed(2)),
        windSpeedMs: Number(nearest.windSpeedMs.toFixed(3)),
        windDirectionDeg: Number(nearest.windDirectionDeg.toFixed(1)),
        source: nearest.source,
        mode,
        requested: { latitude: lat, longitude: lng }
    };
}

module.exports = {
    getNearestWindObservation,
    getWindVelocityGrid,
    parseAqTrackerWind,
    parseWindCsv,
    windToDirectionFromDeg,
    fetchAqTrackerRecords,
    decodeAqTrackerGrid,
    parseCsvRecords
};
