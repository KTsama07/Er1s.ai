'use strict';

const prisma = require('../db');

const VALID_EVENT_TYPES = ['SESSION', 'SIGNUP', 'DEMO_REQUEST', 'PIPELINE_CREATED', 'DEAL_CLOSED'];

// ---------------------------------------------------------------------------
// 1. logConversionEvent
// ---------------------------------------------------------------------------
/**
 * Writes a single ConversionEvent record to the database.
 * @param {{ brandId:string, scanId?:string, utmSource?:string, utmMedium?:string,
 *            utmCampaign?:string, sessionId?:string, eventType:string,
 *            pipelineValue?:number, occurredAt?:Date }} data
 * @returns {Promise<ConversionEvent>} the created record
 */
async function logConversionEvent(data) {
    const { brandId, scanId, utmSource, utmMedium, utmCampaign,
            sessionId, eventType, pipelineValue, occurredAt } = data;

    if (!brandId) throw new Error('brandId is required');
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
        throw new Error(`eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
    }

    return prisma.conversionEvent.create({
        data: {
            brandId,
            scanId:        scanId        || null,
            utmSource:     utmSource     || null,
            utmMedium:     utmMedium     || null,
            utmCampaign:   utmCampaign   || null,
            sessionId:     sessionId     || null,
            eventType,
            pipelineValue: pipelineValue != null ? parseFloat(pipelineValue) : null,
            occurredAt:    occurredAt    ? new Date(occurredAt) : new Date()
        }
    });
}

// ---------------------------------------------------------------------------
// 2. getConversionSummary
// ---------------------------------------------------------------------------
/**
 * Returns an aggregate summary of conversion events for a brand:
 *   - totalPipelineByType:  Sum of pipelineValue grouped by eventType
 *   - weeklyConversions:    Count of events per ISO week for last 12 weeks
 *   - byUtmSource:          Count + pipeline grouped by utmSource
 *   - recentEvents:         Most recent 10 events
 */
async function getConversionSummary(brandId) {
    if (!brandId) throw new Error('brandId is required');

    const [totalPipelineByType, weeklyConversions, byUtmSource, recentEvents] = await Promise.all([
        // Pipeline by eventType
        prisma.$queryRaw`
            SELECT
                "eventType",
                COUNT(*)::int          AS "count",
                COALESCE(SUM("pipelineValue"), 0)::float AS "totalPipeline"
            FROM "ConversionEvent"
            WHERE "brandId" = ${brandId}
            GROUP BY "eventType"
            ORDER BY "totalPipeline" DESC
        `,

        // Weekly conversion counts for the last 12 weeks
        prisma.$queryRaw`
            SELECT
                DATE_TRUNC('week', "occurredAt") AS "weekStart",
                COUNT(*)::int  AS "count",
                COALESCE(SUM("pipelineValue"), 0)::float AS "pipeline"
            FROM "ConversionEvent"
            WHERE "brandId" = ${brandId}
              AND "occurredAt" >= NOW() - INTERVAL '12 weeks'
            GROUP BY DATE_TRUNC('week', "occurredAt")
            ORDER BY "weekStart" ASC
        `,

        // By UTM source
        prisma.$queryRaw`
            SELECT
                COALESCE("utmSource", 'direct') AS "utmSource",
                COUNT(*)::int  AS "count",
                COALESCE(SUM("pipelineValue"), 0)::float AS "pipeline"
            FROM "ConversionEvent"
            WHERE "brandId" = ${brandId}
            GROUP BY COALESCE("utmSource", 'direct')
            ORDER BY "count" DESC
        `,

        // Most recent 10 events
        prisma.conversionEvent.findMany({
            where:   { brandId },
            orderBy: { occurredAt: 'desc' },
            take:    10
        })
    ]);

    return { totalPipelineByType, weeklyConversions, byUtmSource, recentEvents };
}

// ---------------------------------------------------------------------------
// 3. correlateScanToConversions
// ---------------------------------------------------------------------------
/**
 * Lag correlation: for each completed Scan in the last 90 days, computes
 * how many ConversionEvents and how much pipeline occurred in the 3-week
 * window AFTER that scan.
 *
 * @returns {Promise<Array<{
 *   scanId:string, scanDate:Date, visibilityScore:number,
 *   conversionsInNextThreeWeeks:number, pipelineInNextThreeWeeks:number
 * }>>}
 */
async function correlateScanToConversions(brandId) {
    if (!brandId) throw new Error('brandId is required');

    const rows = await prisma.$queryRaw`
        SELECT
            s.id                                         AS "scanId",
            s."createdAt"                                AS "scanDate",
            s."visibilityScore"                          AS "visibilityScore",
            COUNT(ce.id)::int                            AS "conversionsInNextThreeWeeks",
            COALESCE(SUM(ce."pipelineValue"), 0)::float  AS "pipelineInNextThreeWeeks"
        FROM "Scan" s
        LEFT JOIN "ConversionEvent" ce
            ON  ce."brandId"   = s."brandId"
            AND ce."occurredAt" > s."createdAt"
            AND ce."occurredAt" <= s."createdAt" + INTERVAL '21 days'
        WHERE s."brandId" = ${brandId}
          AND s."status"  = 'COMPLETED'
          AND s."createdAt" >= NOW() - INTERVAL '90 days'
        GROUP BY s.id, s."createdAt", s."visibilityScore"
        ORDER BY s."createdAt" ASC
    `;

    return rows;
}

module.exports = { logConversionEvent, getConversionSummary, correlateScanToConversions };
