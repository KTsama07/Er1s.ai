const express = require('express');
const prisma = require('../db');

const router = express.Router();

/**
 * GET /api/brands/:brandId/visibility-trend
 *
 * Returns:
 *  - weeklyScores:       Weekly avg visibilityScore for last 12 weeks
 *  - intentBreakdown:    Avg queryScore grouped by queryIntent for last 30 days
 *  - mentionTypeWeekly:  mentionType distribution (count) per ISO week, last 12 weeks
 *  - worstQueries:       Top 5 worst-performing queries by queryScore in the last scan
 */
router.get('/:brandId/visibility-trend', async (req, res) => {
    const { brandId } = req.params;

    try {
        // ── 1. Weekly average visibilityScore for last 12 weeks ──────────────
        const weeklyScores = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC('week', s."createdAt") AS week_start,
                ROUND(AVG(s."visibilityScore")::numeric, 2) AS avg_visibility_score,
                COUNT(*)::int AS scan_count
            FROM "Scan" s
            WHERE
                s."brandId"  = ${brandId}
                AND s."status" = 'COMPLETED'
                AND s."createdAt" >= NOW() - INTERVAL '12 weeks'
            GROUP BY week_start
            ORDER BY week_start ASC
        `;

        // ── 2. Avg queryScore by queryIntent for last 30 days ────────────────
        const intentBreakdown = await prisma.$queryRaw`
            SELECT
                q."queryIntent",
                ROUND(AVG(ar."queryScore")::numeric, 2) AS avg_query_score,
                COUNT(ar.id)::int AS response_count
            FROM "AiResponse" ar
            INNER JOIN "Scan"  s ON ar."scanId"  = s.id
            INNER JOIN "Query" q ON ar."queryId" = q.id
            WHERE
                s."brandId"  = ${brandId}
                AND s."status" = 'COMPLETED'
                AND s."createdAt" >= NOW() - INTERVAL '30 days'
            GROUP BY q."queryIntent"
            ORDER BY avg_query_score DESC
        `;

        // ── 3. mentionType distribution per ISO week, last 12 weeks ──────────
        const mentionTypeWeekly = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC('week', s."createdAt") AS week_start,
                m."mentionType",
                COUNT(*)::int AS mention_count
            FROM "Mention" m
            INNER JOIN "AiResponse" ar ON m."aiResponseId" = ar.id
            INNER JOIN "Scan"       s  ON ar."scanId"      = s.id
            WHERE
                s."brandId"  = ${brandId}
                AND s."status" = 'COMPLETED'
                AND s."createdAt" >= NOW() - INTERVAL '12 weeks'
                AND m."brandId" IS NOT NULL   -- only brand mentions, not competitors
            GROUP BY week_start, m."mentionType"
            ORDER BY week_start ASC, m."mentionType"
        `;

        // ── 4. Top 5 worst-performing queries in the last completed scan ──────
        const lastScan = await prisma.scan.findFirst({
            where: { brandId, status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, createdAt: true }
        });

        let worstQueries = [];
        if (lastScan) {
            worstQueries = await prisma.$queryRaw`
                SELECT
                    q."text"        AS query_text,
                    q."queryIntent",
                    ar."queryScore",
                    ar."responseStructure"
                FROM "AiResponse" ar
                INNER JOIN "Query" q ON ar."queryId" = q.id
                WHERE ar."scanId" = ${lastScan.id}
                ORDER BY ar."queryScore" ASC NULLS FIRST
                LIMIT 5
            `;
        }

        // ── 5. Avg visibilityScore by aiModel for the last 12 weeks ──────────
        const modelBreakdown = await prisma.$queryRaw`
            SELECT 
              ar."aiModel",
              DATE_TRUNC('week', s."createdAt") as week_start,
              ROUND(AVG(ar."queryScore")::numeric, 2) as avg_score
            FROM "AiResponse" ar
            JOIN "Scan" s ON ar."scanId" = s.id
            WHERE s."brandId" = ${brandId}
              AND s.status = 'COMPLETED'
            GROUP BY ar."aiModel", week_start
            ORDER BY week_start DESC
        `;

        res.json({
            brandId,
            generatedAt: new Date().toISOString(),
            weeklyScores,
            intentBreakdown,
            mentionTypeWeekly,
            modelBreakdown,
            worstQueries: {
                scanId:    lastScan?.id   ?? null,
                scanDate:  lastScan?.createdAt ?? null,
                results:   worstQueries
            }
        });

    } catch (err) {
        console.error('[visibility-trend] Error:', err);
        res.status(500).json({ error: 'Failed to fetch visibility trend data', detail: err.message });
    }
});

module.exports = router;
