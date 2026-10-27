const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const UTM_K0 = 0.9996;

const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);

function degreesToRadians(value) {
    return value * Math.PI / 180;
}

function radiansToDegrees(value) {
    return value * 180 / Math.PI;
}

function utmZoneFromLongitude(longitude) {
    return Math.floor((longitude + 180) / 6) + 1;
}

function centralMeridianRadians(zone) {
    return degreesToRadians((zone - 1) * 6 - 180 + 3);
}

function wgs84ToUtm({ latitude, longitude, zone = utmZoneFromLongitude(longitude) }) {
    const lat = degreesToRadians(latitude);
    const lon = degreesToRadians(longitude);
    const lon0 = centralMeridianRadians(zone);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const tanLat = Math.tan(lat);

    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const t = tanLat * tanLat;
    const c = WGS84_EP2 * cosLat * cosLat;
    const a = cosLat * (lon - lon0);

    const m = WGS84_A * (
        (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256) * lat
        - (3 * WGS84_E2 / 8 + 3 * WGS84_E2 ** 2 / 32 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(2 * lat)
        + (15 * WGS84_E2 ** 2 / 256 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(4 * lat)
        - (35 * WGS84_E2 ** 3 / 3072) * Math.sin(6 * lat)
    );

    const easting = UTM_K0 * n * (
        a
        + (1 - t + c) * a ** 3 / 6
        + (5 - 18 * t + t ** 2 + 72 * c - 58 * WGS84_EP2) * a ** 5 / 120
    ) + 500000;

    let northing = UTM_K0 * (
        m
        + n * tanLat * (
            a ** 2 / 2
            + (5 - t + 9 * c + 4 * c ** 2) * a ** 4 / 24
            + (61 - 58 * t + t ** 2 + 600 * c - 330 * WGS84_EP2) * a ** 6 / 720
        )
    );

    const hemisphere = latitude >= 0 ? 'N' : 'S';
    if (hemisphere === 'S') {
        northing += 10000000;
    }

    return {
        easting,
        northing,
        zone,
        hemisphere,
        epsg: hemisphere === 'N' ? 32600 + zone : 32700 + zone
    };
}

function utmToWgs84({ easting, northing, zone, hemisphere = 'N' }) {
    const x = easting - 500000;
    const y = hemisphere === 'S' ? northing - 10000000 : northing;
    const lon0 = centralMeridianRadians(zone);

    const m = y / UTM_K0;
    const mu = m / (
        WGS84_A * (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256)
    );
    const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));

    const fp = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

    const sinFp = Math.sin(fp);
    const cosFp = Math.cos(fp);
    const tanFp = Math.tan(fp);
    const c1 = WGS84_EP2 * cosFp * cosFp;
    const t1 = tanFp * tanFp;
    const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinFp * sinFp);
    const r1 = WGS84_A * (1 - WGS84_E2) / ((1 - WGS84_E2 * sinFp * sinFp) ** 1.5);
    const d = x / (n1 * UTM_K0);

    const latitude = fp - (n1 * tanFp / r1) * (
        d ** 2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * WGS84_EP2) * d ** 4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * WGS84_EP2 - 3 * c1 ** 2) * d ** 6 / 720
    );

    const longitude = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d ** 3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * WGS84_EP2 + 24 * t1 ** 2) * d ** 5 / 120
    ) / cosFp;

    return {
        latitude: radiansToDegrees(latitude),
        longitude: radiansToDegrees(longitude)
    };
}

function modelPointToLonLat(point, projection) {
    const wgs84 = utmToWgs84({
        easting: point.x_m,
        northing: point.y_m,
        zone: projection.zone,
        hemisphere: projection.hemisphere
    });

    return [wgs84.longitude, wgs84.latitude];
}

function predictionsToGeoJson(predictions, projection) {
    const features = Object.entries(predictions).map(([minutes, points]) => {
        const coordinates = points.map((point) => modelPointToLonLat(point, projection));
        if (coordinates.length > 0) {
            coordinates.push([...coordinates[0]]);
        }

        return {
            type: 'Feature',
            properties: {
                layer: 'fire_perimeter',
                minutes: Number(minutes),
                source: 'wildfire_analysis',
                crs_epsg: projection.epsg
            },
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            }
        };
    });

    return {
        type: 'FeatureCollection',
        features
    };
}

function arrivalGridToGeoJson(arrivalTimeGrid, projection) {
    return {
        type: 'FeatureCollection',
        features: arrivalTimeGrid.cells.map((cell) => ({
            type: 'Feature',
            properties: {
                layer: 'arrival_time_cell',
                arrival_min: cell.arrival_min,
                i: cell.i,
                j: cell.j,
                crs_epsg: projection.epsg
            },
            geometry: {
                type: 'Point',
                coordinates: modelPointToLonLat(cell, projection)
            }
        }))
    };
}

function modelOutputToGeoJson(modelOutput, projection) {
    return {
        crs: {
            type: 'EPSG',
            code: projection.epsg,
            utm_zone: projection.zone,
            hemisphere: projection.hemisphere
        },
        perimeters: predictionsToGeoJson(modelOutput.predictions || {}, projection),
        arrivalCells: arrivalGridToGeoJson(modelOutput.arrival_time_grid || { cells: [] }, projection)
    };
}

module.exports = {
    modelOutputToGeoJson,
    utmToWgs84,
    utmZoneFromLongitude,
    wgs84ToUtm
};
