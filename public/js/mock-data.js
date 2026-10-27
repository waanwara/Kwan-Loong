(function () {
    window.KwanLongMockData = {
        dataFreshness: {
            hotspot: {
                source: 'FIRMS / Air4Laos',
                interval: '12 hours',
                confidence: 'candidate-hotspot'
            },
            weather: {
                source: 'NCM / AQ Tracker fallback',
                interval: '10 minutes',
                confidence: 'forecast-observation'
            },
            terrain: {
                source: 'GFW / elevation-derived slope',
                interval: 'static',
                confidence: 'terrain-derived'
            }
        },
        defaultRothermelScenario: {
            fuelModelId: 'SH2',
            windSpeedKmh: 18,
            windDirectionDeg: 270,
            slopePercent: 12,
            fuelMoisturePercent: 9,
            latitude: 17.9757,
            longitude: 102.6331
        }
    };
})();
