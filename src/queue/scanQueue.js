'use strict';

const Bull = require('bull');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ---------------------------------------------------------------------------
// Queue definition
// ---------------------------------------------------------------------------
const scanQueue = new Bull('scan-queue', REDIS_URL, {
    defaultJobOptions: {
        attempts: 1,            // Don't auto-retry — scans are expensive
        removeOnComplete: 100,  // Keep last 100 completed jobs
        removeOnFail:     50
    }
});

module.exports = scanQueue;
