'use strict';

const express = require('express');
const { runScan } = require('../services/scanService');
const scanQueue = require('../queue/scanQueue');
const prisma = require('../db');
const { calculateVisibilityScore } = require('../services/scoringService');

const router = express.Router({ mergeParams: true }); // Access :brandId

// ---------------------------------------------------------------------------
// POST /scan/:brandId/run  — enqueue an async scan, return immediately
// ---------------------------------------------------------------------------
router.post('/run', async (req, res) => {
    try {
        const { brandId } = req.params;

        // Verify the brand exists before queuing
        const brand = await prisma.brand.findUnique({ where: { id: brandId } });
        if (!brand) return res.status(404).json({ error: 'Brand not found' });

        // Prevent overlapping scans for the same brand
        const activeScan = await prisma.scan.findFirst({
            where: { brandId, status: { in: ['PENDING', 'PROCESSING'] } }
        });
        if (activeScan) {
            return res.status(409).json({ error: 'A scan is already in progress for this brand', scanId: activeScan.id });
        }

        // Create the Scan record in PENDING state — the queue will flip it to PROCESSING
        const scan = await prisma.scan.create({
            data: { brandId, status: 'PENDING' }
        });

        const models = req.body?.models || ["gemini-3.1-flash-lite"];
        const queryIds = req.body?.queryIds || null;
        const batchId = req.body?.batchId || null;

        // Add the job to the Bull queue (non-blocking)
        await scanQueue.add({ brandId, scanId: scan.id, options: { models, queryIds, batchId } }, { jobId: scan.id });

        res.status(202).json({
            message:  'Scan started',
            scanId:   scan.id,
            status:   'PENDING',
            pollUrl:  `/scan/${brandId}/status/${scan.id}`
        });

    } catch (error) {
        console.error('Scan Enqueue Error:', error);
        res.status(500).json({ error: error.message || 'Failed to start scan' });
    }
});

// ---------------------------------------------------------------------------
// GET /scan/:brandId/status/:scanId  — poll scan progress/result
// ---------------------------------------------------------------------------
router.get('/status/:scanId', async (req, res) => {
    try {
        const { brandId, scanId } = req.params;

        const scan = await prisma.scan.findFirst({
            where: { id: scanId, brandId },
            select: {
                id:             true,
                status:         true,
                visibilityScore: true,
                failureReason:  true,
                createdAt:      true
            }
        });

        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const payload = {
            scanId:          scan.id,
            status:          scan.status,
            visibilityScore: scan.visibilityScore,
            failureReason:   scan.failureReason,
            createdAt:       scan.createdAt
        };

        // On completion, attach the full scoring breakdown via the latest route logic
        if (scan.status === 'COMPLETED') {
            const full = await prisma.scan.findUnique({
                where: { id: scanId },
                include: {
                    aiResponses: {
                        select: {
                            id:                true,
                            queryId:           true,
                            aiModel:           true,
                            content:           true,
                            responseStructure: true,
                            queryScore:        true,
                            mentions: {
                                select: {
                                    brandId:        true,
                                    competitorId:   true,
                                    rankPosition:   true,
                                    sentiment:      true,
                                    mentionType:    true,
                                    mentionContext: true,
                                    isInList:       true
                                }
                            },
                            query: { select: { text: true, queryIntent: true } }
                        }
                    }
                }
            });
            payload.aiResponses = full.aiResponses;
            
            const brand = await prisma.brand.findUnique({
                where: { id: brandId },
                include: { competitors: true }
            });
            if (brand && full.aiResponses) {
                const scoreData = calculateVisibilityScore(full.aiResponses, brand.id, brand.competitors);
                payload.scoring = {
                    brandScore: scoreData.brandScore,
                    brandAvgRank: scoreData.brandAvgRank,
                    competitors: brand.competitors.map(c => ({
                        id: c.id,
                        name: c.name,
                        score: scoreData.competitorScores[c.id] || 0,
                        avgRank: scoreData.competitorAvgRanks[c.id] || null
                    }))
                };
            }
        }

        res.json(payload);

    } catch (error) {
        console.error('Status Fetch Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ---------------------------------------------------------------------------
// GET /scan/:brandId/latest  — fetch most recent scan details (unchanged)
// ---------------------------------------------------------------------------
router.get('/latest', async (req, res) => {
    try {
        const { brandId } = req.params;

        const scan = await prisma.scan.findFirst({
            where:   { brandId },
            orderBy: { createdAt: 'desc' },
            include: {
                aiResponses: {
                    select: {
                        id:                true,
                        queryId:           true,
                        aiModel:           true,
                        content:           true,
                        responseStructure: true,
                        queryScore:        true,
                        mentions: {
                            select: {
                                brandId:        true,
                                competitorId:   true,
                                rankPosition:   true,
                                sentiment:      true,
                                mentionType:    true,
                                mentionContext: true,
                                characterIndex: true,
                                isInList:       true
                            }
                        },
                        query: { select: { text: true, queryIntent: true } }
                    }
                }
            }
        });

        if (!scan) return res.status(404).json({ message: 'No scans found for this brand.' });

        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            include: { competitors: true }
        });
        if (brand && scan.aiResponses) {
            const scoreData = calculateVisibilityScore(scan.aiResponses, brand.id, brand.competitors);
            scan.scoring = {
                brandScore: scoreData.brandScore,
                brandAvgRank: scoreData.brandAvgRank,
                competitors: brand.competitors.map(c => ({
                    id: c.id,
                    name: c.name,
                    score: scoreData.competitorScores[c.id] || 0,
                    avgRank: scoreData.competitorAvgRanks[c.id] || null
                }))
            };
        }

        res.json(scan);
    } catch (error) {
        console.error('Error fetching latest scan:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ---------------------------------------------------------------------------
// GET /scan/:brandId/history  — fetch all historical scans
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
    try {
        const { brandId } = req.params;

        const scans = await prisma.scan.findMany({
            where:   { brandId },
            orderBy: { createdAt: 'desc' },
            include: {
                aiResponses: {
                    select: {
                        id:                true,
                        queryId:           true,
                        aiModel:           true,
                        content:           true,
                        responseStructure: true,
                        queryScore:        true,
                        mentions: {
                            select: {
                                brandId:        true,
                                competitorId:   true,
                                rankPosition:   true,
                                sentiment:      true,
                                mentionType:    true,
                                mentionContext: true,
                                characterIndex: true,
                                isInList:       true
                            }
                        },
                        query: { select: { text: true, queryIntent: true } }
                    }
                }
            }
        });

        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            include: { competitors: true }
        });

        // Add scoring to each historical scan
        if (brand) {
            for (let scan of scans) {
                if (scan.aiResponses) {
                    const scoreData = calculateVisibilityScore(scan.aiResponses, brand.id, brand.competitors);
                    scan.scoring = {
                        brandScore: scoreData.brandScore,
                        brandAvgRank: scoreData.brandAvgRank,
                        competitors: brand.competitors.map(c => ({
                            id: c.id,
                            name: c.name,
                            score: scoreData.competitorScores[c.id] || 0,
                            avgRank: scoreData.competitorAvgRanks[c.id] || null
                        }))
                    };
                }
            }
        }

        res.json(scans);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
