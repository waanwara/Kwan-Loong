const fuelModels = [
    {
        id: 'GR1',
        name: 'Short sparse grass',
        category: 'grass',
        description: 'Low fuel load grass model for early calibration and UI integration.',
        typicalFuelLoadKgM2: 0.10
    },
    {
        id: 'SH2',
        name: 'Moderate shrub',
        category: 'shrub',
        description: 'Shrub-heavy surface fuel placeholder for Laos upland scenarios.',
        typicalFuelLoadKgM2: 0.48
    },
    {
        id: 'TU5',
        name: 'Timber understory',
        category: 'timber-understory',
        description: 'Forest understory placeholder for mixed terrain fire behavior trials.',
        typicalFuelLoadKgM2: 0.82
    }
];

module.exports = fuelModels;
