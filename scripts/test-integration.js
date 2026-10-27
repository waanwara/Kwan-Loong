const assert = require('assert');

const { initializeDatabase } = require('../src/db');
const {
    estimateFireBehavior,
    estimateFireBehaviorFromHotspot
} = require('../src/services/rothermelService');
const { parseFirmsCsv } = require('../src/services/firmsService');
const { mapTreeCoverToFuelModel } = require('../src/services/environmentService');
const { parseAqTrackerWind, parseWindCsv, windToDirectionFromDeg } = require('../src/services/windService');
const { utmToWgs84, wgs84ToUtm } = require('../src/services/geoProjection');

function assertNear(actual, expected, tolerance, message) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${message}: expected ${expected}, got ${actual}`
    );
}

function testProjectionRoundTrip() {
    const latitude = 17.9757;
    const longitude = 102.6331;
    const projected = wgs84ToUtm({ latitude, longitude });
    const roundTrip = utmToWgs84({
        easting: projected.easting,
        northing: projected.northing,
        zone: projected.zone,
        hemisphere: projected.hemisphere
    });

    assert.strictEqual(projected.epsg, 32648);
    assertNear(roundTrip.latitude, latitude, 1e-7, 'latitude round trip');
    assertNear(roundTrip.longitude, longitude, 1e-7, 'longitude round trip');
}

function testRothermelIntegration() {
    initializeDatabase();
    const result = estimateFireBehavior(
        {
            fuelModelId: 'SH2',
            windSpeedKmh: 18,
            slopePercent: 12,
            fuelMoisturePercent: 9,
            latitude: 17.9757,
            longitude: 102.6331
        },
        { persist: false }
    );

    assert.strictEqual(result.modelStatus, 'mvp-0.2.0');
    assert.ok(result.estimate.spreadRateMMin > 0);
    assert.ok(result.modelOutput.predictions['30']);
    assert.ok(result.modelOutput.arrival_time_grid.cells.length > 0);
    assert.strictEqual(result.modelOutputGeoJson.crs.code, 32648);
    assert.ok(result.modelOutputGeoJson.perimeters.features.length > 0);
    assert.ok(result.modelOutputGeoJson.arrivalCells.features.length > 0);
}

function testFirmsCsvParser() {
    const csv = [
        'latitude,longitude,bright_ti4,acq_date,acq_time,satellite,instrument,confidence,frp,daynight',
        '17.9757,102.6331,330.1,2026-09-11,0430,N,VIIRS,n,12.5,D'
    ].join('\n');
    const hotspots = parseFirmsCsv(csv);

    assert.strictEqual(hotspots.length, 1);
    assert.strictEqual(hotspots[0].latitude, 17.9757);
    assert.strictEqual(hotspots[0].longitude, 102.6331);
    assert.strictEqual(hotspots[0].frp, 12.5);
}

function testWindParsers() {
    assert.strictEqual(windToDirectionFromDeg(1, 0), 270);
    assert.strictEqual(windToDirectionFromDeg(0, -1), 0);

    const csv = [
        'latitude,longitude,u,v,wind_speed,wind_direction',
        '17.5,102.5,1,0,1,90'
    ].join('\n');
    const csvPoints = parseWindCsv(csv);
    assert.strictEqual(csvPoints.length, 1);
    assert.strictEqual(csvPoints[0].windSpeedKmh, 3.6);
    assert.strictEqual(csvPoints[0].windDirectionDeg, 270);

    const apiPoints = parseAqTrackerWind([
        {
            header: {
                parameterNumberName: 'U-component_of_wind',
                nx: 1,
                ny: 1,
                lo1: 102.5,
                la1: 17.5,
                dx: 0.5,
                dy: 0.5
            },
            data: [1]
        },
        {
            header: {
                parameterNumberName: 'V-component_of_wind',
                nx: 1,
                ny: 1,
                lo1: 102.5,
                la1: 17.5,
                dx: 0.5,
                dy: 0.5
            },
            data: [0]
        }
    ]);
    assert.strictEqual(apiPoints[0].windDirectionDeg, 270);
}

function testFuelHeuristic() {
    assert.strictEqual(mapTreeCoverToFuelModel(10).fuelModelId, 'GR1');
    assert.strictEqual(mapTreeCoverToFuelModel(40).fuelModelId, 'SH2');
    assert.strictEqual(mapTreeCoverToFuelModel(80).fuelModelId, 'TU5');
}

async function testEstimateFromHotspot() {
    const result = await estimateFireBehaviorFromHotspot(
        {
            hotspot: {
                latitude: 17.9757,
                longitude: 102.6331,
                acquisitionDate: '2026-09-11',
                acquisitionTime: '0430'
            },
            useLiveEnvironment: false
        },
        { persist: false }
    );

    assert.strictEqual(result.modelStatus, 'mvp-0.2.0');
    assert.ok(result.modelOutputGeoJson.perimeters.features.length > 0);
}

testProjectionRoundTrip();
testRothermelIntegration();
testFirmsCsvParser();
testWindParsers();
testFuelHeuristic();

testEstimateFromHotspot()
    .then(() => {
        console.log('Integration smoke tests passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
