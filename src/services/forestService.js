/**
 * Live per-point tree-cover lookup against Global Forest Watch (GFW).
 *
 * Request shape here is deliberately verified against apitocsv.py's working
 * forest()/get_avg_tree_cover() reference implementation - GFW's API is
 * picky about exact field names and will fail silently (empty/short
 * response) rather than error clearly if you get them wrong, which is what
 * happened in a previous version of this file:
 *   - /geostore wants a bare {"geometry": {...}} body, not wrapped in
 *     "geojson" or a GeoJSON "Feature".
 *   - It needs an area to average over, not a single Point - a Point has
 *     zero area, so a tree-cover AVG query over a point-derived geostore
 *     comes back empty. We use a small bounding box instead.
 *   - The created geostore's id comes back as data.gfw_geostore_id, not
 *     data.id.
 *   - The query SQL must reference the actual dataset table/column
 *     (umd_tree_cover_density_2000 / umd_tree_cover_density_2000__percent),
 *     and needs geostore_origin=gfw as a query param or the query service
 *     won't resolve the geostore we just created.
 */

const GFW_API_KEY = process.env.GFW_API_KEY || '';
const GFW_GEOSTORE_URL = process.env.GFW_GEOSTORE_URL || 'https://data-api.globalforestwatch.org/geostore';
const GFW_TREE_COVER_URL = process.env.GFW_TREE_COVER_URL
    || 'https://data-api.globalforestwatch.org/dataset/umd_tree_cover_density_2000/v1.8/query/json';
const REQUEST_TIMEOUT_MS = Number(process.env.GFW_TIMEOUT_MS || 15000);
const CACHE_TTL_MS = Number(process.env.GFW_CACHE_TTL_MS || 24 * 60 * 60 * 1000); // tree cover barely changes day to day

const cache = new Map(); // "lat,lon" (rounded) -> { treeCoverPct, expiresAt }

function isGfwConfigured() {
    return Boolean(GFW_API_KEY);
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function cacheKey(lat, lon) {
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'content-type': 'application/json',
                ...(options.headers || {})
            }
        });

        return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
    } finally {
        clearTimeout(timeout);
    }
}

// Bare Polygon geometry - matches what /geostore actually accepts. Mirrors
// apitocsv.py's make_bbox_geojson(lat, lon, half_res=0.25).
function buildBboxGeometry(lat, lon, halfRes = 0.25) {
    return {
        type: 'Polygon',
        coordinates: [[
            [lon - halfRes, lat - halfRes],
            [lon + halfRes, lat - halfRes],
            [lon + halfRes, lat + halfRes],
            [lon - halfRes, lat + halfRes],
            [lon - halfRes, lat - halfRes]
        ]]
    };
}

async function createGeostore(latitude, longitude) {
    const { ok, status, body } = await fetchJson(GFW_GEOSTORE_URL, {
        method: 'POST',
        headers: { 'x-api-key': GFW_API_KEY },
        body: JSON.stringify({ geometry: buildBboxGeometry(latitude, longitude) })
    });

    if (!ok) {
        throw new Error(`GFW geostore request failed (${status}): ${JSON.stringify(body)?.slice(0, 200)}`);
    }

    // The real field name GFW returns, per apitocsv.py's verified working call.
    const geostoreId = body?.data?.gfw_geostore_id;
    if (!geostoreId) {
        throw new Error(`GFW geostore response did not include gfw_geostore_id: ${JSON.stringify(body)?.slice(0, 200)}`);
    }

    return geostoreId;
}

function extractTreeCoverValue(body) {
    const row = Array.isArray(body?.data) ? body.data[0] : null;
    // avg_tree_cover is the alias used in our SQL below; keep a couple of
    // fallbacks in case GFW ever changes casing/aliasing on us.
    const raw = row?.avg_tree_cover ?? row?.value ?? row?.avg ?? null;
    return toNumber(raw);
}

async function queryAvgTreeCover(geostoreId, { retries = 3 } = {}) {
    const url = new URL(GFW_TREE_COVER_URL);
    url.searchParams.set('sql', 'SELECT AVG(umd_tree_cover_density_2000__percent) AS avg_tree_cover FROM umd_tree_cover_density_2000');
    url.searchParams.set('geostore_id', geostoreId);
    url.searchParams.set('geostore_origin', 'gfw');

    for (let attempt = 0; attempt < retries; attempt += 1) {
        const { ok, status, body } = await fetchJson(url.toString(), {
            headers: { 'x-api-key': GFW_API_KEY }
        });

        if (ok) {
            return extractTreeCoverValue(body);
        }

        if (status === 504) {
            await sleep(2000);
            continue;
        }

        throw new Error(`GFW tree-cover query failed (${status}): ${JSON.stringify(body)?.slice(0, 200)}`);
    }

    throw new Error('GFW tree-cover query timed out after retries');
}

async function fetchAvgTreeCoverFromGfw(latitude, longitude) {
    if (!isGfwConfigured()) {
        throw new Error('GFW_API_KEY is not configured');
    }

    const lat = toNumber(latitude);
    const lon = toNumber(longitude);
    if (lat === null || lon === null) {
        throw new Error('latitude and longitude are required for GFW tree-cover lookup');
    }

    const key = cacheKey(lat, lon);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.treeCoverPct;
    }

    const geostoreId = await createGeostore(lat, lon);
    let treeCoverPct = await queryAvgTreeCover(geostoreId);

    // Tree cover is a percentage by definition. If GFW ever hands back
    // something outside 0-100 (wrong units, a bad aggregate), treat it as
    // no usable data rather than displaying a nonsense number.
    if (!(Number.isFinite(treeCoverPct) && treeCoverPct >= 0 && treeCoverPct <= 100)) {
        console.warn(`[forestService] Discarding out-of-range GFW tree cover ${treeCoverPct} for (${lat}, ${lon})`);
        treeCoverPct = null;
    }

    cache.set(key, { treeCoverPct, expiresAt: Date.now() + CACHE_TTL_MS });

    if (treeCoverPct === null) {
        throw new Error('GFW tree-cover response did not include a usable numeric value');
    }

    return treeCoverPct;
}

module.exports = {
    fetchAvgTreeCoverFromGfw,
    isGfwConfigured
};
