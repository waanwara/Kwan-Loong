const DEFAULT_SOURCE = process.env.FIRMS_DEFAULT_SOURCE || 'VIIRS_SNPP_NRT';
const DEFAULT_BBOX = process.env.FIRMS_DEFAULT_BBOX || '101.5,17.0,103.5,19.0';
const DEFAULT_DAY_RANGE = Number(process.env.FIRMS_DEFAULT_DAY_RANGE || 1);

function parseNumber(value) {
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

function parseFirmsCsv(csv) {
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return [];

    const headers = parseCsvLine(lines[0]).map((header) => header.trim());
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const row = headers.reduce((record, header, index) => {
            record[header] = values[index];
            return record;
        }, {});

        const latitude = parseNumber(row.latitude);
        const longitude = parseNumber(row.longitude);
        const brightness = parseNumber(row.bright_ti4 ?? row.brightness);
        const frp = parseNumber(row.frp);

        return {
            latitude,
            longitude,
            source: row.instrument || row.satellite || null,
            satellite: row.satellite || null,
            instrument: row.instrument || null,
            confidence: row.confidence || null,
            brightness,
            frp,
            acquisitionDate: row.acq_date || null,
            acquisitionTime: row.acq_time || null,
            dayNight: row.daynight || null,
            raw: row
        };
    }).filter((hotspot) => hotspot.latitude !== null && hotspot.longitude !== null);
}

function normalizeBbox(rawBbox) {
    const bbox = String(rawBbox || DEFAULT_BBOX)
        .split(',')
        .map((value) => Number(value.trim()));

    if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
        throw new Error('bbox must be west,south,east,north');
    }

    const [west, south, east, north] = bbox;
    if (west >= east || south >= north) {
        throw new Error('bbox must satisfy west < east and south < north');
    }
    if (west < -180 || east > 180 || south < -90 || north > 90) {
        throw new Error('bbox is outside valid WGS84 bounds');
    }

    return bbox.join(',');
}

function normalizeDayRange(rawDayRange) {
    const dayRange = Number(rawDayRange ?? DEFAULT_DAY_RANGE);
    if (!Number.isInteger(dayRange) || dayRange < 1 || dayRange > 5) {
        throw new Error('dayRange must be an integer between 1 and 5');
    }
    return dayRange;
}

async function fetchFirmsHotspots(options = {}) {
    const mapKey = process.env.FIRMS_MAP_KEY;
    if (!mapKey) {
        throw new Error('FIRMS_MAP_KEY is not configured');
    }

    const source = options.source || DEFAULT_SOURCE;
    const bbox = normalizeBbox(options.bbox);
    const dayRange = normalizeDayRange(options.dayRange);
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/${encodeURIComponent(source)}/${bbox}/${dayRange}`;

    const response = await fetch(url);
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`FIRMS request failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const hotspots = parseFirmsCsv(text);
    return {
        source,
        bbox,
        dayRange,
        count: hotspots.length,
        hotspots
    };
}

module.exports = {
    fetchFirmsHotspots,
    parseFirmsCsv
};
