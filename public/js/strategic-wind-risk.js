/**
 * Strategic tab: provincial wind conditions + Rothermel fire-spread risk.
 *
 * For every province we call POST /api/rothermel/estimate with
 * `useLiveEnvironment: true`, the same backend endpoint dispatch.html uses
 * (see js/dispatch-rothermel.js). The backend fills in live wind, fuel model
 * and slope/moisture defaults for us (src/services/environmentService.js),
 * then runs the Rothermel-based spread model
 * (src/services/rothermelService.js -> wildfireModelAdapter.js) and returns
 * spreadRateMMin / flameLengthM / riskIndex.
 *
 * We pass `persist: false` (src/routes/rothermelRoutes.js) so this bulk,
 * read-only overview doesn't write 21 synthetic rows into fire_scenarios
 * every time the tab is opened/refreshed.
 */
(function () {
    // Mirrors provinces.csv at the project root.
    const PROVINCES = [
        { name: 'Attapu', latitude: 14.81071, longitude: 106.83184 },
        { name: 'Ban Houakhoua', latitude: 20.2467, longitude: 100.45401 },
        { name: 'Ban Houayxay', latitude: 20.27652, longitude: 100.41302 },
        { name: 'Champasak', latitude: 14.89162, longitude: 105.87818 },
        { name: 'Không', latitude: 14.11726, longitude: 105.85322 },
        { name: 'Lamam', latitude: 15.41705, longitude: 106.69461 },
        { name: 'Louang Namtha', latitude: 20.9486, longitude: 101.40188 },
        { name: 'Louangphabang', latitude: 19.88601, longitude: 102.13503 },
        { name: 'Muang Pakxan', latitude: 18.38261, longitude: 103.65857 },
        { name: 'Muang Phôn-Hông', latitude: 18.49565, longitude: 102.41421 },
        { name: 'Muang Phônsavan', latitude: 19.45, longitude: 103.21667 },
        { name: 'Muang Xay', latitude: 20.69229, longitude: 101.98368 },
        { name: 'Pakxé', latitude: 15.12022, longitude: 105.79898 },
        { name: 'Phôngsali', latitude: 21.68372, longitude: 102.10536 },
        { name: 'Phonsavan', latitude: 19.45907, longitude: 103.17999 },
        { name: 'Sainyabuli', latitude: 19.25756, longitude: 101.71032 },
        { name: 'Salavan', latitude: 15.71677, longitude: 106.42172 },
        { name: 'Savannakhét', latitude: 16.56505, longitude: 104.75273 },
        { name: 'Thakhèk', latitude: 17.41027, longitude: 104.83068 },
        { name: 'Vangviang', latitude: 18.9235, longitude: 102.44784 },
        { name: 'Vientiane', latitude: 17.96667, longitude: 102.6 },
        { name: 'Xam Nua', latitude: 20.41591, longitude: 104.04838 }
    ];

    const MAX_CONCURRENT_REQUESTS = 4;
    const FUEL_MODEL_NAMES = {
        GR1: 'Short sparse grass',
        SH2: 'Moderate shrub',
        TU5: 'Timber understory'
    };
    // "Risk" from the Rothermel model alone answers "how badly would a fire
    // behave here IF one started", independent of whether a fire actually
    // exists anywhere nearby. That's misleading as a standalone number, so we
    // gate it against real FIRMS active-fire hotspots: if nothing is burning
    // within FIRE_PROXIMITY_KM, there is nothing that could currently spread
    // into the province, and displayed risk is forced to 0%.
    // Tune this radius to taste - it's a straight-line "could plausibly reach
    // here" cutoff, not a spread-time calculation.
    const FIRE_PROXIMITY_KM = 20;

    let cache = null; // array of resolved province results, once a full pass succeeds
    let loading = false;
    let windSortMode = 'alphabetical';

    function t(key, fallback) {
        try {
            const text = window.getText ? window.getText(key) : null;
            return text && text !== key ? text : fallback;
        } catch {
            return fallback;
        }
    }

    function compassLabel(deg) {
        if (!Number.isFinite(deg)) return '-';
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(((deg % 360) / 22.5)) % 16];
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
    }

    async function fetchFireHotspots() {
        if (!window.KwanLongApi) return { hotspots: [], available: false };
        try {
            const response = await window.KwanLongApi.get('/api/data/firms/hotspots');
            const hotspots = (response.data?.hotspots || []).filter(
                (h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude)
            );
            return { hotspots, available: true, source: response.data?.source };
        } catch (error) {
            // FIRMS unavailable (no key configured, network error, etc.) - we
            // fall back to model-only risk rather than silently forcing 0%,
            // since "no data" and "confirmed no fire nearby" are different
            // things and shouldn't look the same.
            return { hotspots: [], available: false, error: error.message };
        }
    }

    function nearestFireKm(province, fireInfo) {
        if (!fireInfo.available || !fireInfo.hotspots.length) return null;
        let min = Infinity;
        for (const hotspot of fireInfo.hotspots) {
            const d = haversineKm(province.latitude, province.longitude, hotspot.latitude, hotspot.longitude);
            if (d < min) min = d;
        }
        return Number.isFinite(min) ? min : null;
    }

    function riskBucket(result, fireInfo) {
        if (result.error) {
            return { key: 'unknown', label: t('risk_unknown', 'UNKNOWN'), rowClass: 'text-slate-400', displayIndex: null };
        }

        const riskIndex = Number.isFinite(result.riskIndex) ? Math.max(0, Math.min(100, result.riskIndex)) : null;

        // Gate: if we successfully checked FIRMS and nothing is burning
        // within range, there's no existing fire that could spread here -
        // show 0% regardless of how flammable the conditions are.
        if (fireInfo.available && (result.nearestFireKm === null || result.nearestFireKm > FIRE_PROXIMITY_KM)) {
            return {
                key: 'none',
                label: t('no_fire_nearby', 'NO ACTIVE FIRE NEARBY'),
                rowClass: 'text-slate-500',
                displayIndex: 0
            };
        }

        if (riskIndex === null) {
            return { key: 'unknown', label: t('risk_unknown', 'UNKNOWN'), rowClass: 'text-slate-400', displayIndex: null };
        }
        if (riskIndex >= 70) {
            return { key: 'high', label: t('high_risk', 'HIGH RISK'), rowClass: 'text-red-400', displayIndex: riskIndex };
        }
        if (riskIndex >= 40) {
            return { key: 'medium', label: t('med_risk', 'MEDIUM RISK'), rowClass: 'text-amber-400', displayIndex: riskIndex };
        }
        return { key: 'low', label: t('low_risk', 'LOW RISK'), rowClass: 'text-emerald-400', displayIndex: riskIndex };
    }

    function fuelDisplay(environment, fuelModelId) {
        const treeCoverPct = environment?.forest?.treeCoverPct;
        const modelName = FUEL_MODEL_NAMES[fuelModelId] || fuelModelId || '-';
        const isFallback = environment?.fuel?.confidence === 'fallback' || !Number.isFinite(treeCoverPct);

        if (!isFallback) {
            const density = treeCoverPct >= 60 ? t('high_density_label', 'High Density')
                : treeCoverPct >= 30 ? t('med_density_label', 'Medium Density')
                    : t('low_density_label', 'Low Density');
            return {
                percent: Math.round(treeCoverPct),
                text: `${Math.round(treeCoverPct)}% ${density}`,
                modelName,
                isFallback: false
            };
        }

        // No local tree-cover sample exists for this point (laos_forest.csv is
        // missing / GFW_API_KEY unset in this deployment), so the backend
        // returns the same constant fallback fuel model everywhere. Showing a
        // computed percentage here would look like a real per-province
        // measurement when it's actually a fixed default - so we say so
        // instead of fabricating a number.
        return {
            percent: null,
            text: `${modelName} (${t('fallback_no_data', 'no tree-cover data')})`,
            modelName,
            isFallback: true
        };
    }

    function recommendation(bucket, windSpeedKmh) {
        const strongWind = Number.isFinite(windSpeedKmh) && windSpeedKmh >= 25;
        if (bucket.key === 'none') {
            return t('advice_none', 'No active fire within range - routine monitoring only');
        }
        if (bucket.key === 'high') {
            return strongWind
                ? t('advice_high_wind', 'Construct advance firebreak immediately - high winds will accelerate spread')
                : t('advice_high', 'Construct advance firebreak immediately');
        }
        if (bucket.key === 'medium') {
            return t('advice_medium', 'Monitor via Unmanned Aerial Vehicles (UAV)');
        }
        return t('advice_low', 'Routine patrol - no immediate action needed');
    }

    async function fetchProvince(province, fireInfo) {
        const response = await window.KwanLongApi.post('/api/rothermel/estimate', {
            latitude: province.latitude,
            longitude: province.longitude,
            useLiveEnvironment: true,
            persist: false
        });

        const data = response.data;
        const scenario = data.scenario || {};
        const estimate = data.estimate || {};
        const environment = data.environment || {};

        return {
            province: province.name,
            latitude: province.latitude,
            longitude: province.longitude,
            windSpeedKmh: scenario.windSpeedKmh,
            windDirectionDeg: scenario.windDirectionDeg,
            windSource: environment.wind?.source || '-',
            // PM2.5 rides along on the same /api/rothermel/estimate call the
            // wind figures already come from (the backend resolves both from
            // one cached AQ Tracker grid), so showing it costs no extra
            // request per province.
            pm25: environment.airQuality?.pm25 ?? null,
            pm25Category: environment.airQuality?.category?.key || null,
            pm25Source: environment.airQuality?.source || null,
            fuelModelId: scenario.fuelModel?.id,
            fuel: fuelDisplay({ ...environment, fuel: { ...environment.fuel, typicalFuelLoadKgM2: scenario.fuelModel?.typicalFuelLoadKgM2 } }, scenario.fuelModel?.id),
            spreadRateMMin: estimate.spreadRateMMin,
            flameLengthM: estimate.flameLengthM,
            riskIndex: estimate.riskIndex,
            spreadDirectionDeg: estimate.spreadDirectionDeg,
            nearestFireKm: nearestFireKm(province, fireInfo),
            error: null
        };
    }

    async function fetchProvinceSafe(province, fireInfo) {
        try {
            return await fetchProvince(province, fireInfo);
        } catch (error) {
            return {
                province: province.name,
                latitude: province.latitude,
                longitude: province.longitude,
                error: error.message || 'Unavailable'
            };
        }
    }

    async function fetchAllProvinces(fireInfo, onProgress) {
        const results = new Array(PROVINCES.length);
        let nextIndex = 0;

        async function worker() {
            while (nextIndex < PROVINCES.length) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await fetchProvinceSafe(PROVINCES[index], fireInfo);
                if (onProgress) onProgress(results, index);
            }
        }

        const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, PROVINCES.length);
        await Promise.all(Array.from({ length: workerCount }, worker));
        return results;
    }

    // Thai PCD / US EPA-aligned 24h PM2.5 bands. Keys are produced by the
    // backend (src/services/pm25Service.js) so the thresholds live in exactly
    // one place - this map only decides how each band looks.
    const PM25_STYLES = {
        good: { text: 'text-emerald-400', dot: 'bg-emerald-400', labelKey: 'pm25_good', fallback: 'Good' },
        moderate: { text: 'text-yellow-400', dot: 'bg-yellow-400', labelKey: 'pm25_moderate', fallback: 'Moderate' },
        unhealthy_sensitive: { text: 'text-orange-400', dot: 'bg-orange-400', labelKey: 'pm25_sensitive', fallback: 'Sensitive groups' },
        unhealthy: { text: 'text-red-400', dot: 'bg-red-400', labelKey: 'pm25_unhealthy', fallback: 'Unhealthy' },
        hazardous: { text: 'text-fuchsia-400', dot: 'bg-fuchsia-400', labelKey: 'pm25_hazardous', fallback: 'Hazardous' }
    };

    function pm25RowHtml(result) {
        const value = Number.isFinite(result.pm25) ? result.pm25 : null;

        if (value === null) {
            // Distinguish "we asked and there's no reading" from a real zero -
            // a fabricated 0 ug/m3 would read as pristine air.
            return `
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] text-slate-500 shrink-0">PM2.5</span>
                    <span class="text-[10px] text-slate-600 truncate">${t('pm25_unavailable', 'no reading')}</span>
                </div>`;
        }

        const style = PM25_STYLES[result.pm25Category] || {
            text: 'text-slate-300', dot: 'bg-slate-500', labelKey: 'pm25_unknown', fallback: '-'
        };

        return `
            <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] text-slate-500 shrink-0">PM2.5</span>
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}"></span>
                    <span class="text-[10px] text-slate-400 truncate">${t(style.labelKey, style.fallback)}</span>
                    <span class="text-sm font-mono font-bold shrink-0 ${style.text}">${value.toFixed(1)}</span>
                    <span class="text-[10px] text-slate-400 shrink-0">µg/m³</span>
                </div>
            </div>`;
    }

    function windCardHtml(result) {
        if (result.error) {
            return `
                <div class="glass-panel rounded-xl p-3 border border-glass-border">
                    <div class="text-xs font-bold text-white truncate">${result.province}</div>
                    <div class="text-[10px] text-slate-500 mt-1">${result.error}</div>
                </div>`;
        }

        const speed = Number.isFinite(result.windSpeedKmh) ? result.windSpeedKmh.toFixed(1) : '-';
        const dir = Number.isFinite(result.windDirectionDeg) ? Math.round(result.windDirectionDeg) : null;
        const rotation = Number.isFinite(result.windDirectionDeg) ? result.windDirectionDeg + 180 : 0;

        return `
            <div class="glass-panel rounded-xl p-3 border border-glass-border space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <div class="text-xs font-bold text-white truncate">${result.province}</div>
                        <div class="text-[10px] text-slate-400 truncate">${dir !== null ? `${dir}° ${compassLabel(dir)}` : '-'} · ${result.windSource}</div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="material-symbols-outlined text-secondary text-lg" style="transform: rotate(${rotation}deg);">navigation</span>
                        <span class="text-sm font-mono font-bold text-secondary">${speed}</span>
                        <span class="text-[10px] text-slate-400">km/h</span>
                    </div>
                </div>
                <div class="border-t border-slate-700/40 pt-2">
                    ${pm25RowHtml(result)}
                </div>
            </div>`;
    }

    function compareDescendingWithMissing(aValue, bValue) {
        const aValid = Number.isFinite(aValue);
        const bValid = Number.isFinite(bValue);
        if (aValid && bValid && bValue !== aValue) return bValue - aValue;
        if (aValid !== bValid) return aValid ? -1 : 1;
        return 0;
    }

    function sortWindResults(results) {
        return [...results].sort((a, b) => {
            let metricOrder = 0;
            if (windSortMode === 'pm25') {
                metricOrder = compareDescendingWithMissing(a.pm25, b.pm25);
            } else if (windSortMode === 'wind') {
                metricOrder = compareDescendingWithMissing(a.windSpeedKmh, b.windSpeedKmh);
            }
            return metricOrder || String(a.province).localeCompare(String(b.province), 'en', {
                sensitivity: 'base'
            });
        });
    }

    function riskRowHtml(result, fireInfo) {
        if (result.error) {
            return `
                <tr>
                    <td class="p-2 text-white font-bold">${result.province}</td>
                    <td class="p-2 text-slate-500" colspan="3">${t('risk_unavailable', 'Risk data unavailable')}: ${result.error}</td>
                </tr>`;
        }

        const bucket = riskBucket(result, fireInfo);
        const windText = Number.isFinite(result.windSpeedKmh)
            ? `${result.windSpeedKmh.toFixed(1)} km/h ${compassLabel(result.windDirectionDeg)}`
            : '-';
        const fuelClass = result.fuel.isFallback ? 'text-slate-500 italic' : 'text-amber-400';
        const percentText = Number.isFinite(bucket.displayIndex) ? ` (${Math.round(bucket.displayIndex)}%)` : '';
        const fireNote = fireInfo.available && Number.isFinite(result.nearestFireKm)
            ? ` · ${t('nearest_fire', 'nearest active fire')} ${result.nearestFireKm.toFixed(1)} km`
            : '';

        return `
            <tr>
                <td class="p-2 text-white font-bold">${result.province}</td>
                <td class="p-2 ${bucket.rowClass} font-bold">${bucket.label}${percentText}</td>
                <td class="p-2 ${fuelClass}">${result.fuel.text}</td>
                <td class="p-2 text-slate-300">
                    <span class="text-slate-400">${windText}${fireNote} ·</span>
                    ${recommendation(bucket, result.windSpeedKmh)}
                </td>
            </tr>`;
    }

    function render(results, fireInfo) {
        const windGrid = document.getElementById('provincialWindGrid');
        if (windGrid) {
            windGrid.innerHTML = sortWindResults(results).map(windCardHtml).join('');
        }

        const riskBody = document.getElementById('strategicRiskMatrixBody');
        if (riskBody) {
            const sorted = [...results].sort((a, b) => {
                const aIdx = riskBucket(a, fireInfo).displayIndex ?? -1;
                const bIdx = riskBucket(b, fireInfo).displayIndex ?? -1;
                return bIdx - aIdx;
            });
            riskBody.innerHTML = sorted.map((r) => riskRowHtml(r, fireInfo)).join('');
        }

        const statusEl = document.getElementById('strategicRiskStatus');
        if (statusEl) {
            const ok = results.filter((r) => !r.error).length;
            const pm25Ok = results.filter((r) => Number.isFinite(r.pm25)).length;
            const now = new Date().toLocaleTimeString();
            const fireNote = fireInfo.available
                ? `${fireInfo.hotspots.length} ${t('active_hotspots', 'active hotspots')} (${fireInfo.source || 'FIRMS'})`
                : t('fire_data_unavailable', 'fire-proximity check unavailable');
            // Call out PM2.5 coverage separately: wind can be fine while the
            // air-quality field is missing from the upstream frame, and a
            // silent row of "no reading" shouldn't look like a page bug.
            const pm25Note = pm25Ok
                ? `PM2.5 ${pm25Ok}/${results.length}`
                : t('pm25_data_unavailable', 'PM2.5 unavailable');
            statusEl.textContent = `${ok}/${results.length} provinces · ${fireNote} · ${pm25Note} · ${t('last_updated', 'updated')} ${now}`;
        }
    }

    function renderLoadingSkeleton() {
        const windGrid = document.getElementById('provincialWindGrid');
        if (windGrid) {
            windGrid.innerHTML = PROVINCES.map((p) => `
                <div class="glass-panel rounded-xl p-3 border border-glass-border animate-pulse space-y-2">
                    <div>
                        <div class="text-xs font-bold text-slate-500">${p.name}</div>
                        <div class="text-[10px] text-slate-600 mt-1">${t('loading', 'Loading...')}</div>
                    </div>
                    <div class="border-t border-slate-700/40 pt-2">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[10px] text-slate-600">PM2.5</span>
                            <span class="text-[10px] text-slate-700">--</span>
                        </div>
                    </div>
                </div>`).join('');
        }
        const riskBody = document.getElementById('strategicRiskMatrixBody');
        if (riskBody) {
            riskBody.innerHTML = `
                <tr><td class="p-2 text-slate-500 font-mono" colspan="4">${t('loading_risk', 'Calculating Rothermel fire-spread risk for every province...')}</td></tr>`;
        }
    }

    async function load(force) {
        if (loading) return;
        if (cache && !force) {
            render(cache.results, cache.fireInfo);
            return;
        }

        loading = true;
        const button = document.getElementById('btnRefreshStrategicRisk');
        if (button) button.disabled = true;

        renderLoadingSkeleton();

        try {
            const fireInfo = await fetchFireHotspots();
            const results = await fetchAllProvinces(fireInfo, (partial) => render(partial.filter(Boolean), fireInfo));
            cache = { results, fireInfo };
            render(results, fireInfo);
        } finally {
            loading = false;
            if (button) button.disabled = false;
        }
    }

    window.KwanLongStrategicRisk = {
        load,
        refresh: () => load(true)
    };

    // Load automatically the first time the Strategic tab becomes visible,
    // by wrapping the existing global switchTab() if it's already defined.
    function hookSwitchTab() {
        if (typeof window.switchTab !== 'function' || window.switchTab.__strategicRiskWrapped) return;
        const original = window.switchTab;
        function wrapped(tabName) {
            original(tabName);
            if (tabName === 'strategic') {
                window.KwanLongStrategicRisk.load(false);
            }
        }
        wrapped.__strategicRiskWrapped = true;
        window.switchTab = wrapped;
    }

    window.addEventListener('DOMContentLoaded', () => {
        hookSwitchTab();
        const hash = window.location.hash.replace('#', '');
        if (hash === 'strategic' || document.getElementById('view-strategic')?.classList.contains('flex')) {
            load(false);
        }

        const refreshBtn = document.getElementById('btnRefreshStrategicRisk');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => window.KwanLongStrategicRisk.refresh());
        }

        const sortSelect = document.getElementById('strategicWindSort');
        if (sortSelect) {
            windSortMode = sortSelect.value || 'alphabetical';
            sortSelect.addEventListener('change', () => {
                windSortMode = sortSelect.value || 'alphabetical';
                if (cache) render(cache.results, cache.fireInfo);
            });
        }
    });
})();
