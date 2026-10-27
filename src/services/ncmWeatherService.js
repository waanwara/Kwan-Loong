function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function fillTemplate(template, values) {
    return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));
}

function normalizeNcmWeatherPayload(payload) {
    const record = Array.isArray(payload) ? payload[0] : payload;
    if (!record || typeof record !== 'object') {
        throw new Error('NCM response did not contain a weather record');
    }

    const windSpeedKmh = toNumber(
        record.windSpeedKmh
        ?? record.wind_speed_kmh
        ?? record.wind_speed_10m_kmh
        ?? (toNumber(record.wind_speed_10m) === null ? null : toNumber(record.wind_speed_10m) * 3.6)
        ?? (toNumber(record.wind_speed_ms) === null ? null : toNumber(record.wind_speed_ms) * 3.6)
    );
    const windDirectionDeg = toNumber(
        record.windDirectionDeg
        ?? record.wind_direction_deg
        ?? record.wind_dir_10m
        ?? record.wind_direction_10m
    );

    if (windSpeedKmh === null || windDirectionDeg === null) {
        throw new Error('NCM response is missing wind speed or direction fields');
    }

    return {
        windSpeedKmh: Number(windSpeedKmh.toFixed(2)),
        windSpeedMs: Number((windSpeedKmh / 3.6).toFixed(3)),
        windDirectionDeg: Number(windDirectionDeg.toFixed(1)),
        temperatureC: toNumber(record.temperatureC ?? record.temperature_c ?? record.t_2m),
        relativeHumidityFraction: (() => {
            const humidity = toNumber(record.relativeHumidity ?? record.relative_humidity ?? record.rh_2m);
            if (humidity === null) return null;
            return humidity > 1 ? Number((humidity / 100).toFixed(3)) : humidity;
        })(),
        rainfallMmDay: toNumber(record.rainfallMmDay ?? record.rainfall_mm_day ?? record.precip_24h ?? record.precipitation),
        source: 'ncm',
        raw: record
    };
}

async function getNcmWeatherForLocation({ latitude, longitude } = {}) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat === null || lng === null) {
        throw new Error('latitude and longitude are required for NCM weather lookup');
    }

    const template = process.env.NCM_WEATHER_URL_TEMPLATE;
    if (!template) {
        throw new Error('NCM_WEATHER_URL_TEMPLATE is not configured');
    }

    const url = fillTemplate(template, {
        lat,
        lng,
        latitude: lat,
        longitude: lng
    });

    const headers = {};
    if (process.env.NCM_API_TOKEN) {
        headers.Authorization = `Bearer ${process.env.NCM_API_TOKEN}`;
    }

    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`NCM weather request failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = JSON.parse(text);
    return {
        ...normalizeNcmWeatherPayload(payload),
        requested: { latitude: lat, longitude: lng },
        fetchedAt: new Date().toISOString()
    };
}

module.exports = {
    getNcmWeatherForLocation,
    normalizeNcmWeatherPayload
};
