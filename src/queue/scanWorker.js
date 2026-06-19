'use strict';

const scanQueue = require('./scanQueue');
const { runScan } = require('../services/scanService');
const prisma = require('../db');

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------
scanQueue.process(async (job) => {
    const { brandId, scanId, options } = job.data;
    console.log(`[Queue] Starting scan job ${job.id} — brandId=${brandId} scanId=${scanId}`);

    await runScan(brandId, scanId, options);

    console.log(`[Queue] Scan job ${job.id} completed.`);
});

// ---------------------------------------------------------------------------
// Failure handler — update Scan record with error message
// ---------------------------------------------------------------------------
scanQueue.on('failed', async (job, err) => {
    const { scanId } = job.data;
    console.error(`[Queue] Scan job ${job.id} FAILED:`, err.message);
    try {
        await prisma.scan.update({
            where: { id: scanId },
            data:  { status: 'FAILED', failureReason: err.message }
        });
    } catch (updateErr) {
        console.error('[Queue] Could not update scan status to FAILED:', updateErr.message);
    }
});

scanQueue.on('error', (err) => {
    console.error('[Queue] Bull queue error:', err.message);
});

module.exports = scanQueue;
