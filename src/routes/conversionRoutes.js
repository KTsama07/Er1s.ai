'use strict';

const express = require('express');
const {
    logConversionEvent,
    getConversionSummary,
    correlateScanToConversions
} = require('../services/conversionService');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /conversions
// Creates a new ConversionEvent record.
// Body: { brandId, eventType, utmSource?, utmMedium?, utmCampaign?,
//         sessionId?, scanId?, pipelineValue?, occurredAt? }
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    try {
        const event = await logConversionEvent(req.body || {});
        res.status(201).json(event);
    } catch (err) {
        const status = err.message.includes('required') || err.message.includes('must be one of')
            ? 400 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /conversions/:brandId/summary
// Returns aggregated pipeline, weekly counts, UTM breakdown, recent events.
// ---------------------------------------------------------------------------
router.get('/:brandId/summary', async (req, res) => {
    try {
        const summary = await getConversionSummary(req.params.brandId);
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /conversions/:brandId/correlation
// Returns lag-correlation: scan visibility score vs pipeline in next 3 weeks.
// Core citation-to-revenue proof.
// ---------------------------------------------------------------------------
router.get('/:brandId/correlation', async (req, res) => {
    try {
        const data = await correlateScanToConversions(req.params.brandId);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
