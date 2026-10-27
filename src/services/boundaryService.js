const ODM_PACKAGE_URL = process.env.ODM_BOUNDARY_PACKAGE_URL
    || 'https://data.opendevelopmentmekong.net/api/3/action/package_show?id=laos-administrative-boundaries-country-province-and-district';

const DEFAULT_BOUNDARY_GEOJSON_URL = process.env.ODM_BOUNDARY_GEOJSON_URL || '';

let boundaryCache = null;

const ADMIN_LAYER_BY_LEVEL = {
    country: 'adm0',
    province: 'adm1',
    district: 'adm2'
};

function scoreResource(resource, level) {
    const name = `${resource.name || ''} ${resource.description || ''}`.toLowerCase();
    const format = String(resource.format || '').toLowerCase();
    const levelToken = ADMIN_LAYER_BY_LEVEL[level] || 'adm1';
    let score = 0;

    if (format.includes('geojson') || String(resource.url || '').toLowerCase().includes('geojson')) score += 10;
    if (format.includes('wms')) score += 8;
    if (name.includes(levelToken)) score += 6;
    if (level === 'province' && name.includes('province')) score += 5;
    if (level === 'district' && name.includes('district')) score += 5;
    if (level === 'country' && name.includes('country')) score += 5;
    if (String(resource.url || '').toLowerCase().includes('wfs')) score += 2;

    return score;
}

function wmsDescriptorFromUrl(url) {
    const parsed = new URL(url);
    const layers = parsed.searchParams.get('layers') || parsed.searchParams.get('typeName');
    return {
        url: `${parsed.origin}${parsed.pathname}`,
        layers
    };
}

async function discoverBoundaryResource(level) {
    if (DEFAULT_BOUNDARY_GEOJSON_URL) {
        return { kind: 'geojson', url: DEFAULT_BOUNDARY_GEOJSON_URL };
    }

    const response = await fetch(ODM_PACKAGE_URL);
    if (!response.ok) {
        throw new Error(`ODM boundary package request failed (${response.status})`);
    }

    const payload = await response.json();
    const resources = payload?.result?.resources || [];
    const best = resources
        .map((resource) => ({ resource, score: scoreResource(resource, level) }))
        .filter((entry) => entry.score > 0 && entry.resource.url)
        .sort((a, b) => b.score - a.score)[0];

    if (!best) {
        throw new Error('No ODM boundary resource was discovered');
    }

    const format = String(best.resource.format || '').toLowerCase();
    if (format.includes('wms')) {
        return { kind: 'wms', ...wmsDescriptorFromUrl(best.resource.url) };
    }

    return { kind: 'geojson', url: best.resource.url };
}

async function fetchLaosBoundaries({ level = 'province', refresh = false } = {}) {
    if (boundaryCache && !refresh && boundaryCache.level === level) {
        return boundaryCache;
    }

    const resource = await discoverBoundaryResource(level);
    if (resource.kind === 'wms') {
        boundaryCache = {
            level,
            kind: 'wms',
            source: 'Open Development Mekong / National Geographic Department',
            license: 'Creative Commons Attribution',
            url: resource.url,
            fetchedAt: new Date().toISOString(),
            wms: {
                url: resource.url,
                layers: resource.layers,
                format: 'image/png',
                transparent: true
            }
        };
        return boundaryCache;
    }

    const response = await fetch(resource.url);
    if (!response.ok) {
        throw new Error(`ODM boundary GeoJSON request failed (${response.status})`);
    }

    const geojson = await response.json();
    boundaryCache = {
        level,
        kind: 'geojson',
        source: 'Open Development Mekong / National Geographic Department',
        license: 'Creative Commons Attribution',
        url: resource.url,
        fetchedAt: new Date().toISOString(),
        geojson
    };

    return boundaryCache;
}

module.exports = {
    fetchLaosBoundaries
};
