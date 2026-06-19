const express = require('express');
const prisma = require('../db');

const router = express.Router();

// POST /brands -> Creates a brand along with its competitors
router.post('/', async (req, res) => {
    try {
        const { name, competitors } = req.body || {};

        if (!name) return res.status(400).json({ error: "Brand name is required" });

        const competitorsData = competitors ? competitors.map(c => ({ name: c })) : [];

        const brand = await prisma.brand.create({
            data: {
                name,
                competitors: {
                    create: competitorsData
                }
            },
            include: {
                competitors: true
            }
        });

        res.status(201).json(brand);
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ error: "Brand already exists." });
        console.error("Error creating brand:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /brands -> Returns all brands with query count
router.get('/', async (req, res) => {
    try {
        const brands = await prisma.brand.findMany({
            include: {
                competitors: { select: { id: true, name: true } },
                _count: { select: { queries: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(brands);
    } catch (error) {
        console.error("Error fetching brands:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /brand/:brandId/score-history
router.get('/:brandId/score-history', async (req, res) => {
    try {
        const { brandId } = req.params;

        const scans = await prisma.scan.findMany({
            where: {
                brandId,
                status: 'COMPLETED'
            },
            orderBy: { createdAt: 'asc' }, // Chronological for charts
            select: {
                id: true,
                visibilityScore: true,
                createdAt: true
            }
        });

        res.json(scans);
    } catch (error) {
        console.error("Error fetching score history:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// DELETE /brands/:brandId -> Deletes a brand and all cascading relations
router.delete('/:brandId', async (req, res) => {
    try {
        const { brandId } = req.params;
        
        await prisma.brand.delete({
            where: { id: brandId }
        });

        res.status(200).json({ message: "Brand deleted successfully" });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ error: "Brand not found" });
        console.error("Error deleting brand:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST /brands/:brandId/competitors -> Add a competitor to an existing brand
router.post('/:brandId/competitors', async (req, res) => {
    try {
        const { brandId } = req.params;
        const { name } = req.body || {};
        if (!name) return res.status(400).json({ error: "Competitor name is required" });

        const competitor = await prisma.competitor.create({
            data: { name, brandId }
        });

        // --- Backfill: scan previous AI responses for mentions of this new competitor ---
        let backfilledCount = 0;
        try {
            const allResponses = await prisma.aiResponse.findMany({
                where: { scan: { brandId } },
                select: { id: true, content: true }
            });

            const compNameLower = name.toLowerCase();
            const mentionsToCreate = [];

            for (const resp of allResponses) {
                const textLower = resp.content.toLowerCase();
                const index = textLower.indexOf(compNameLower);
                if (index === -1) continue;

                // Extract context window (150 chars before/after)
                const start = Math.max(0, index - 150);
                const end = Math.min(resp.content.length, index + name.length + 150);
                const context = resp.content.substring(start, end);

                // Detect if response is a list
                const hasList = /^\s*(\d+[.)]\s+|[-*•]\s+)/m.test(resp.content);

                // Count existing mentions to figure out rank
                const existingMentions = await prisma.mention.findMany({
                    where: { aiResponseId: resp.id },
                    select: { characterIndex: true },
                    orderBy: { characterIndex: 'asc' }
                });

                // Insert new competitor in rank order by character index
                let rank = 1;
                for (const em of existingMentions) {
                    if (em.characterIndex < index) rank++;
                }

                mentionsToCreate.push({
                    aiResponseId: resp.id,
                    competitorId: competitor.id,
                    rankPosition: rank,
                    sentiment: 'POSITIVE',
                    mentionContext: context,
                    mentionType: 'CASUAL_MENTION',
                    characterIndex: index,
                    isInList: hasList
                });
            }

            if (mentionsToCreate.length > 0) {
                await prisma.mention.createMany({ data: mentionsToCreate });
                backfilledCount = mentionsToCreate.length;
                console.log(`  ✓ Backfilled ${backfilledCount} mention(s) for new competitor "${name}"`);
            }
        } catch (backfillErr) {
            console.warn('  ⚠ Backfill mentions failed (non-fatal):', backfillErr.message);
        }

        res.status(201).json({ ...competitor, backfilledMentions: backfilledCount });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ error: "Competitor already exists for this brand." });
        console.error("Error adding competitor:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// DELETE /brands/:brandId/competitors/:competitorId -> Remove a competitor
router.delete('/:brandId/competitors/:competitorId', async (req, res) => {
    try {
        const { competitorId } = req.params;
        await prisma.competitor.delete({ where: { id: competitorId } });
        res.status(200).json({ message: "Competitor removed" });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ error: "Competitor not found" });
        console.error("Error deleting competitor:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /brands/:brandId/competitors/mentions -> Competitors with the queries they were mentioned in
router.get('/:brandId/competitors/mentions', async (req, res) => {
    try {
        const { brandId } = req.params;
        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            include: { competitors: true }
        });
        if (!brand) return res.status(404).json({ error: 'Brand not found' });

        const result = [];
        for (const comp of brand.competitors) {
            const mentions = await prisma.mention.findMany({
                where: { competitorId: comp.id },
                include: {
                    aiResponse: {
                        select: {
                            queryId: true,
                            aiModel: true,
                            queryScore: true,
                            scan: { select: { createdAt: true } },
                            query: { select: { text: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            // Deduplicate by query text
            const seen = new Set();
            const queryMentions = [];
            for (const m of mentions) {
                const qText = m.aiResponse?.query?.text;
                if (!qText || seen.has(qText)) continue;
                seen.add(qText);
                queryMentions.push({
                    queryText: qText,
                    aiModel: m.aiResponse.aiModel,
                    rankPosition: m.rankPosition,
                    sentiment: m.sentiment,
                    mentionType: m.mentionType,
                    scanDate: m.aiResponse.scan?.createdAt
                });
            }

            result.push({
                id: comp.id,
                name: comp.name,
                mentionCount: queryMentions.length,
                queryMentions
            });
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching competitor mentions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
