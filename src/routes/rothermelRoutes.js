const express = require('express');
const {
    estimateFireBehavior,
    estimateFireBehaviorFromHotspot,
    estimateFireBehaviorWithEnvironment,
    listFuelModels
} = require('../services/rothermelService');

const router = express.Router();

router.get('/fuel-models', (req, res) => {
    res.json({
        success: true,
        data: listFuelModels()
    });
});

router.post('/estimate', async (req, res) => {
    try {
        // `persist` defaults to true (unchanged behaviour). Callers doing bulk,
        // read-only estimates (e.g. the strategic dashboard's per-province scan)
        // can pass `persist: false` so we don't flood fire_scenarios with
        // synthetic rows that would otherwise pollute AAR history.
        const context = { userId: req.user.id, persist: req.body.persist !== false };
        const result = req.body.useLiveEnvironment
            ? await estimateFireBehaviorWithEnvironment(req.body, context)
            : estimateFireBehavior(req.body, context);
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

router.post('/estimate-from-hotspot', async (req, res) => {
    try {
        const result = await estimateFireBehaviorFromHotspot(req.body, { userId: req.user.id });
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
