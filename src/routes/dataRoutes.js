const express = require('express');
const { fetchLaosBoundaries } = require('../services/boundaryService');
const { fetchFirmsHotspots } = require('../services/firmsService');
const { createFirebreakPlan, getFirebreakPlansGeoJson } = require('../services/firebreakService');
const { getEnvironmentForLocation } = require('../services/environmentService');
const { getNearestWindObservation, getWindVelocityGrid } = require('../services/windService');
const { getNearestPm25Observation } = require('../services/pm25Service');

const router = express.Router();

router.get('/firms/hotspots', async (req, res) => {
    try {
        const result = await fetchFirmsHotspots({
            source: req.query.source,
            bbox: req.query.bbox,
            dayRange: req.query.dayRange
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/boundaries/laos-admin', async (req, res) => {
    try {
        const result = await fetchLaosBoundaries({
            level: req.query.level || 'province',
            refresh: req.query.refresh === 'true'
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/firebreaks', (req, res) => {
    try {
        res.json({
            success: true,
            data: getFirebreakPlansGeoJson()
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/firebreaks', (req, res) => {
    try {
        const plan = createFirebreakPlan(req.body, { userId: req.user.id });
        res.status(201).json({
            success: true,
            data: plan
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/wind/latest', async (req, res) => {
    try {
        const result = await getNearestWindObservation({
            latitude: req.query.lat,
            longitude: req.query.lng,
            preferCsv: req.query.preferCsv === 'true'
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Gridded U/V wind field in grib2json shape for the command-map particle layer.
router.get('/wind/grid', async (req, res) => {
    try {
        const result = await getWindVelocityGrid({ force: req.query.force === 'true' });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/pm25/latest', async (req, res) => {
    try {
        const result = await getNearestPm25Observation({
            latitude: req.query.lat,
            longitude: req.query.lng,
            preferCsv: req.query.preferCsv === 'true'
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/environment', async (req, res) => {
    try {
        const result = await getEnvironmentForLocation({
            latitude: req.query.lat,
            longitude: req.query.lng,
            preferCsv: req.query.preferCsv === 'true'
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
