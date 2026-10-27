(function () {
    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function numberValue(id) {
        return Number(document.getElementById(id)?.value);
    }

    function scenarioFromForm() {
        return {
            fuelModelId: document.getElementById('fuelModelSelect')?.value,
            windSpeedKmh: numberValue('windSpeedInput'),
            windDirectionDeg: numberValue('windDirectionInput'),
            slopePercent: numberValue('slopeInput'),
            fuelMoisturePercent: numberValue('fuelMoistureInput'),
            latitude: numberValue('originLatInput'),
            longitude: numberValue('originLngInput'),
            useLiveEnvironment: false
        };
    }

    function renderFreshness() {
        const freshness = window.KwanLongMockData?.dataFreshness;
        if (!freshness) return;

        setText('hotspotFreshness', `${freshness.hotspot.source} | update ${freshness.hotspot.interval}`);
        setText('weatherFreshness', `${freshness.weather.source} | update ${freshness.weather.interval}`);
        setText('terrainFreshness', `${freshness.terrain.source} | ${freshness.terrain.interval}`);
    }

    async function loadFuelModels() {
        const select = document.getElementById('fuelModelSelect');
        if (!select || !window.KwanLongApi) return;

        try {
            const response = await window.KwanLongApi.get('/api/rothermel/fuel-models');
            select.innerHTML = '';

            response.data.forEach((model) => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = `${model.id} - ${model.name}`;
                select.appendChild(option);
            });

            select.value = window.KwanLongMockData?.defaultRothermelScenario?.fuelModelId || response.data[0]?.id;
            setText('rothermelStatus', 'Fuel models loaded from backend');
        } catch (error) {
            setText('rothermelStatus', error.message);
        }
    }

    async function loadFirmsHotspots() {
        if (!window.KwanLongApi) return;

        try {
            const response = await window.KwanLongApi.get('/api/data/firms/hotspots');
            const { count, source, dayRange } = response.data;
            setText('hotspotFreshness', `${source} | ${count} hotspot(s) | last ${dayRange} day(s)`);
            window.dispatchEvent(new CustomEvent('kwanlong:firms-hotspots', {
                detail: response.data
            }));
        } catch (error) {
            setText('hotspotFreshness', `FIRMS unavailable: ${error.message}`);
        }
    }

    async function loadEnvironmentForCurrentPoint() {
        if (!window.KwanLongApi) return null;

        const latitude = numberValue('originLatInput');
        const longitude = numberValue('originLngInput');
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        try {
            setText('weatherFreshness', 'Loading live wind...');
            const path = `/api/data/environment?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`;
            const response = await window.KwanLongApi.get(path);
            const environment = response.data;

            setInput('windSpeedInput', environment.wind.windSpeedKmh);
            setInput('windDirectionInput', environment.wind.windDirectionDeg);
            setInput('fuelModelSelect', environment.fuel.fuelModelId);

            const weatherProvider = environment.wind.source === 'ncm' ? 'NCM' : environment.wind.source;
            setText('weatherFreshness', `${weatherProvider} | ${environment.wind.windSpeedKmh} km/h from ${environment.wind.windDirectionDeg} deg`);
            setText('terrainFreshness', environment.forest
                ? `GFW tree cover CSV | ${environment.forest.treeCoverPct ?? '-'}% | ${environment.fuel.fuelModelId}`
                : `Fuel fallback | ${environment.fuel.fuelModelId} | ${environment.fuel.confidence}`);
            setText('rothermelStatus', `Live inputs loaded | ${environment.fuel.fuelModelId}`);
            window.dispatchEvent(new CustomEvent('kwanlong:environment', {
                detail: environment
            }));

            return environment;
        } catch (error) {
            setText('weatherFreshness', `Live wind unavailable: ${error.message}`);
            return null;
        }
    }

    async function runEstimate() {
        if (!window.KwanLongApi) return;

        setText('rothermelStatus', 'Calculating...');

        try {
            const response = await window.KwanLongApi.post('/api/rothermel/estimate', scenarioFromForm());
            const estimate = response.data.estimate;

            setText('spreadRateValue', `${estimate.spreadRateMMin} m/min`);
            setText('flameLengthValue', `${estimate.flameLengthM} m`);
            setText('riskIndexValue', `${estimate.riskIndex}`);
            setText(
                'rothermelStatus',
                `Model ${response.data.modelStatus} | dir ${estimate.spreadDirectionDeg} deg | cells ${estimate.arrivalCellCount}`
            );
            window.dispatchEvent(new CustomEvent('kwanlong:spread-model', {
                detail: response.data
            }));
        } catch (error) {
            setText('rothermelStatus', error.message);
        }
    }

    function fillDefaults() {
        const defaults = window.KwanLongMockData?.defaultRothermelScenario;
        if (!defaults) return;

        const mapping = {
            windSpeedInput: defaults.windSpeedKmh,
            windDirectionInput: defaults.windDirectionDeg || 270,
            slopeInput: defaults.slopePercent,
            fuelMoistureInput: defaults.fuelMoisturePercent,
            originLatInput: defaults.latitude,
            originLngInput: defaults.longitude
        };

        Object.entries(mapping).forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input) input.value = value;
        });
    }

    function setInput(id, value) {
        const input = document.getElementById(id);
        if (input && value !== undefined && value !== null) {
            input.value = value;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        fillDefaults();
        renderFreshness();
        loadFuelModels();
        loadFirmsHotspots();
        loadEnvironmentForCurrentPoint();

        const form = document.getElementById('rothermelForm');
        if (form) {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                runEstimate();
            });
        }

        ['originLatInput', 'originLngInput'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('change', loadEnvironmentForCurrentPoint);
            }
        });
    });

    window.KwanLongDispatchData = {
        loadEnvironmentForCurrentPoint
    };
})();
