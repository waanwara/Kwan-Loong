let map;
let satelliteTile, darkTile;

window.addEventListener('DOMContentLoaded', () => {
    const mapContainer = document.getElementById('laosMap');
    if (!mapContainer) return;

    // 1. Initializing Map (ประเทศลาว)
    map = L.map('laosMap', {
        zoomControl: false,
        attributionControl: false
    }).setView([18.2, 103.0], 6.5);

    // 2. Define Tile Layers
    satelliteTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 17
    });

    darkTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16
    });

    satelliteTile.addTo(map);

    // 3. Invalidate Size
    setTimeout(() => { map.invalidateSize(); }, 300);

    // 4. Draw Lines & Pins
    drawGlowingFirebreakLines();
    addChokepointMarker(17.9757, 102.6331, "คอขวดธรรมชาติ A (เวียงจันทน์)", "แนะนำสร้างแนวกันไฟ 12.5 กม. | ROI 3.8x");
    addChokepointMarker(19.8845, 102.1350, "คอขวดธรรมชาติ B (หลวงพระบาง)", "แนวกันไฟ 18.2 กม. | ROI 3.2x");
    addChokepointMarker(15.1202, 105.7981, "คอขวดธรรมชาติ C (จำปาสัก)", "แนวกันไฟ 9.4 กม. | ROI 2.5x");

    // Modal Hide
    const popup = document.getElementById('welcomePopup');
    if (popup) {
        setTimeout(() => {
            popup.classList.remove('opacity-100');
            popup.classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => popup.remove(), 500);
        }, 1500);
    }
});

function switchMapStyle(style) {
    if (!map) return;
    const btnSat = document.getElementById('btnSatellite');
    const btnDark = document.getElementById('btnDark');

    if (style === 'satellite') {
        map.removeLayer(darkTile);
        satelliteTile.addTo(map);
        if (btnSat) btnSat.className = "px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition bg-primary text-slate-950 shadow";
        if (btnDark) btnDark.className = "px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition text-slate-300 hover:text-white";
    } else {
        map.removeLayer(satelliteTile);
        darkTile.addTo(map);
        if (btnDark) btnDark.className = "px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition bg-primary text-slate-950 shadow";
        if (btnSat) btnSat.className = "px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition text-slate-300 hover:text-white";
    }
}

function drawGlowingFirebreakLines() {
    const lineVientiane = [
        [18.15, 102.45],
        [18.05, 102.60],
        [17.90, 102.80]
    ];
    const lineLuangPrabang = [
        [19.95, 102.05],
        [19.85, 102.20],
        [19.70, 102.35]
    ];

    L.polyline(lineVientiane, { color: '#10b981', weight: 4, opacity: 0.9 }).addTo(map);
    L.polyline(lineLuangPrabang, { color: '#fbbf24', weight: 4, opacity: 0.9, dashArray: '8, 8' }).addTo(map);
}

function addChokepointMarker(lat, lng, title, desc) {
    const customIcon = L.divIcon({
        className: 'custom-chokepoint-pin',
        html: `<div class="relative flex items-center justify-center">
                <div class="w-8 h-8 rounded-full bg-emerald-400/40 radar-ring absolute"></div>
                <div class="w-4 h-4 rounded-full bg-emerald-400 border-2 border-white relative z-10 shadow-[0_0_12px_#10b981]"></div>
               </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
    const m = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    m.bindPopup(`<div style="color:black; font-family:'Noto Sans Thai', 'Noto Sans Lao', Inter, sans-serif;"><b>${title}</b><br><span style="font-size:11px; color:#444;">${desc}</span></div>`);
}

function mapZoomIn() { if (map) map.zoomIn(); }
function mapZoomOut() { if (map) map.zoomOut(); }
function resetLaosView() { if (map) map.flyTo([18.2, 103.0], 6.5); }
function focusLocation(lat, lng) { if (map) map.flyTo([lat, lng], 10, { duration: 1.2 }); }

function approveFirebreakPlan() {
    const project = document.getElementById('projectSelect')?.value || 'แผนแนวกันไฟ';
    const logConsole = document.getElementById('eventLog');
    if (!logConsole) return;
    const timeStr = new Date().toTimeString().split(' ')[0];
    const newLog = document.createElement('div');
    newLog.className = 'text-primary font-bold';
    newLog.innerHTML = `[${timeStr}] ⚡ APPROVED: อนุมัติ ${project} เรียบร้อยแล้ว`;
    logConsole.appendChild(newLog);
    logConsole.scrollTop = logConsole.scrollHeight;
}
