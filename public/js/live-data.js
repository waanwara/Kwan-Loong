(function () {
    const AOI = {
        latitude: 17.9757,
        longitude: 102.6331,
        bbox: '101.5,17.0,103.5,19.0'
    };

    async function requestJson(path) {
        const response = await fetch(path, { credentials: 'same-origin' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || `Request failed: ${path}`);
        }
        return payload.data;
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function addClass(id, ...classes) {
        const element = document.getElementById(id);
        if (element) element.classList.add(...classes);
    }

    function removeClass(id, ...classes) {
        const element = document.getElementById(id);
        if (element) element.classList.remove(...classes);
    }

    function windDirectionLabel(degrees) {
        const value = Number(degrees);
        if (!Number.isFinite(value)) return '--';
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return directions[Math.round(value / 45) % 8];
    }

    function formatNumber(value, digits = 1) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return '--';
        return numeric.toFixed(digits).replace(/\.0$/, '');
    }

    function hotspotHeatScore(hotspot) {
        const frp = Number(hotspot.frp);
        const brightness = Number(hotspot.brightness);
        if (Number.isFinite(frp)) return Math.min(100, frp * 4);
        if (Number.isFinite(brightness)) return Math.min(100, Math.max(0, brightness - 280));
        return 35;
    }

    function heatColor(value) {
        if (value >= 90) return '#7f1d1d';
        if (value >= 75) return '#dc2626';
        if (value >= 55) return '#f97316';
        if (value >= 35) return '#facc15';
        if (value >= 18) return '#a3e635';
        return '#22c55e';
    }

    function makeHeatIcon(value, diameter) {
        const core = heatColor(value);
        const middle = value >= 55 ? '#f97316' : '#facc15';
        return L.divIcon({
            className: 'live-heat-gradient',
            html: `<div style="width:${diameter}px;height:${diameter}px;border-radius:999px;background:radial-gradient(circle, rgba(255,255,255,.86) 0%, ${core} 14%, ${middle} 42%, rgba(239,68,68,.28) 66%, rgba(239,68,68,0) 78%);box-shadow:0 0 ${Math.round(diameter / 3)}px ${core};mix-blend-mode:screen;"></div>`,
            iconSize: [diameter, diameter],
            iconAnchor: [diameter / 2, diameter / 2]
        });
    }

    function renderHotspotsOnMap(map, hotspots) {
        if (!map || !window.L || !Array.isArray(hotspots)) return null;
        const markers = hotspots
            .filter((hotspot) => Number.isFinite(Number(hotspot.latitude)) && Number.isFinite(Number(hotspot.longitude)))
            .map((hotspot) => {
                const score = hotspotHeatScore(hotspot);
                return L.marker([hotspot.latitude, hotspot.longitude], {
                    icon: makeHeatIcon(score, Math.max(30, Math.min(82, 30 + score * 0.5)))
                }).bindPopup(`
                    <strong>FIRMS Hotspot</strong><br/>
                    FRP: ${hotspot.frp ?? '-'}<br/>
                    Confidence: ${hotspot.confidence ?? '-'}<br/>
                    ${hotspot.acquisitionDate || ''} ${hotspot.acquisitionTime || ''}
                `);
            });
        return L.featureGroup(markers).addTo(map);
    }

    function renderBoundariesOnMap(map, geojson) {
        if (!map || !window.L || !geojson) return null;
        if (geojson.wms?.url && geojson.wms?.layers) {
            return L.tileLayer.wms(geojson.wms.url, {
                layers: geojson.wms.layers,
                format: geojson.wms.format || 'image/png',
                transparent: geojson.wms.transparent !== false,
                opacity: 0.75,
                attribution: 'ODM / NGD'
            }).addTo(map);
        }
        return L.geoJSON(geojson, {
            style: {
                color: '#7dd3fc',
                weight: 1.2,
                opacity: 0.78,
                fillOpacity: 0.02,
                dashArray: '5, 4'
            }
        }).addTo(map);
    }

    function renderFirebreaksOnMap(map, geojson) {
        if (!map || !window.L || !geojson) return null;
        return L.geoJSON(geojson, {
            style: {
                color: '#38bdf8',
                weight: 4,
                opacity: 0.92,
                dashArray: '10, 6'
            }
        }).addTo(map);
    }

    async function loadDashboardLiveData(map) {
        const layers = {};

        try {
            const hotspots = await requestJson(`/api/data/firms/hotspots?bbox=${encodeURIComponent(AOI.bbox)}&dayRange=1`);
            setText('hotspotStat', `${hotspots.count.toLocaleString('en-US')} live`);
            setText('dashboardHotspotSource', `${hotspots.source} | ${hotspots.dayRange}d`);
            setText('strategicHotspotValue', hotspots.count.toLocaleString('en-US'));
            setText('strategicRiskValue', hotspots.count > 20 ? 'HIGH' : hotspots.count > 0 ? 'WATCH' : 'LOW');
            setText('strategicRiskNote', `${hotspots.count} FIRMS hotspot(s) in central Laos AOI`);
            layers.hotspots = renderHotspotsOnMap(map, hotspots.hotspots);
            layers.hotspotData = hotspots.hotspots;
        } catch (error) {
            setText('hotspotStat', 'unavailable');
            setText('dashboardHotspotSource', error.message);
            setText('strategicRiskValue', 'PENDING');
        }

        try {
            const environment = await requestJson(`/api/data/environment?lat=${AOI.latitude}&lng=${AOI.longitude}`);
            const wind = environment.wind || {};
            const weather = environment.weather || {};
            const direction = windDirectionLabel(wind.windDirectionDeg);
            setText('dashboardWindValue', `${formatNumber(wind.windSpeedKmh)} km/h ${direction}`);
            setText('dashboardWindCard', `${formatNumber(wind.windSpeedKmh)} km/h`);
            setText('dashboardWindDirCard', `${direction} ${formatNumber(wind.windDirectionDeg, 0)}°`);
            setText('dashboardHumidityCard', `${formatNumber(Number(weather.relativeHumidityFraction) * 100, 0)}%`);
            setText('dashboardTempCard', `${formatNumber(weather.temperatureC, 1)}°C`);
            setText('dashboardEnvironmentSource', environment.source || 'environment');
            setText('strategicWindNote', `Wind ${formatNumber(wind.windDirectionDeg, 0)}° at ${formatNumber(wind.windSpeedKmh)} km/h`);
        } catch (error) {
            setText('dashboardWindValue', 'unavailable');
            setText('dashboardEnvironmentSource', error.message);
        }

        try {
            const boundaries = await requestJson('/api/data/boundaries/laos-admin?level=province');
            setText('dashboardBoundaryStatus', boundaries.kind === 'wms' ? 'ODM WMS boundary' : 'ODM province boundaries');
            layers.boundaries = renderBoundariesOnMap(map, boundaries.geojson || boundaries);
        } catch (error) {
            setText('dashboardBoundaryStatus', 'boundaries unavailable');
        }

        try {
            const firebreaks = await requestJson('/api/data/firebreaks');
            const count = firebreaks.features?.length || 0;
            setText('dashboardFirebreakStatus', `${count} saved firebreak(s)`);
            setText('dispatchFirebreakValue', `${count} firebreak plan(s)`);
            layers.firebreaks = renderFirebreaksOnMap(map, firebreaks);
        } catch (error) {
            setText('dashboardFirebreakStatus', 'firebreaks unavailable');
        }

        return layers;
    }

    async function loadAarLiveData() {
        try {
            const hotspots = await requestJson(`/api/data/firms/hotspots?bbox=${encodeURIComponent(AOI.bbox)}&dayRange=1`);
            setText('firmsHotspotCount', hotspots.count);
            setText('firmsHotspotWindow', `${hotspots.source} | ${hotspots.dayRange}d`);
            setText('sourceStatusValue', 'LIVE');
            removeClass('sourceStatusValue', 'text-on-surface', 'text-[#EF4444]');
            addClass('sourceStatusValue', 'text-[#10B981]');
        } catch (error) {
            setText('firmsHotspotCount', '--');
            setText('firmsHotspotWindow', 'FIRMS unavailable');
            setText('sourceStatusValue', 'OFF');
            removeClass('sourceStatusValue', 'text-on-surface', 'text-[#10B981]');
            addClass('sourceStatusValue', 'text-[#EF4444]');
        }

        try {
            const environment = await requestJson(`/api/data/environment?lat=${AOI.latitude}&lng=${AOI.longitude}`);
            const wind = environment.wind || {};
            setText('aarWindSource', `${formatNumber(wind.windSpeedKmh)} km/h ${windDirectionLabel(wind.windDirectionDeg)}`);
        } catch (error) {
            setText('aarWindSource', 'weather unavailable');
        }

        try {
            const firebreaks = await requestJson('/api/data/firebreaks');
            setText('aarFirebreakCount', `${firebreaks.features?.length || 0} saved`);
        } catch (error) {
            setText('aarFirebreakCount', 'unavailable');
        }
    }

    async function loadShortcutLiveData() {
        try {
            const hotspots = await requestJson(`/api/data/firms/hotspots?bbox=${encodeURIComponent(AOI.bbox)}&dayRange=1`);
            setText('shortcutHotspots', `${hotspots.count} hotspot(s)`);
            setText('shortcutSource', `${hotspots.source} live`);
        } catch (error) {
            setText('shortcutHotspots', 'FIRMS unavailable');
            setText('shortcutSource', 'offline');
        }

        try {
            const environment = await requestJson(`/api/data/environment?lat=${AOI.latitude}&lng=${AOI.longitude}`);
            const wind = environment.wind || {};
            setText('shortcutWind', `${formatNumber(wind.windSpeedKmh)} km/h ${windDirectionLabel(wind.windDirectionDeg)}`);
        } catch (error) {
            setText('shortcutWind', 'weather unavailable');
        }

        try {
            const firebreaks = await requestJson('/api/data/firebreaks');
            setText('shortcutFirebreaks', `${firebreaks.features?.length || 0} firebreak(s)`);
        } catch (error) {
            setText('shortcutFirebreaks', 'firebreaks unavailable');
        }
    }

    window.KwanLongLiveData = {
        AOI,
        loadDashboardLiveData,
        loadAarLiveData,
        loadShortcutLiveData,
        renderHotspotsOnMap,
        renderBoundariesOnMap,
        renderFirebreaksOnMap
    };
})();
