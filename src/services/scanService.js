const prisma = require('../db');
const { getBatchAiResponses } = require('./aiService');
const { runDetection } = require('./detectionService');
const { calculateVisibilityScore } = require('./scoringService');

const BATCH_SIZE = 5;

/**
 * Splits an array into chunks of a given size.
 */
function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

/**
 * Orchestrates the full scan lifecycle using batched API calls.
 * @param {string} brandId
 * @param {string|null} existingScanId  — when called from the queue, the PENDING
 *   scan record has already been created; pass its ID to reuse it.
 * @param {Object} options — optional parameters like models array.
 */
async function runScan(brandId, existingScanId = null, options = {}) {
    // If an existing scan was queued, update it to PROCESSING.
    // Otherwise create a fresh record (legacy synchronous path).
    const scan = existingScanId
        ? await prisma.scan.update({
              where: { id: existingScanId },
              data:  { status: 'PROCESSING' }
          })
        : await prisma.scan.create({
              data: { brandId, status: 'PROCESSING' }
          });

    try {
        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            include: {
                queries: { 
                    where: { 
                        isActive: true,
                        ...(options.queryIds && options.queryIds.length > 0 ? { id: { in: options.queryIds } } : {}),
                        ...(options.batchId && options.batchId !== 'all' ? (options.batchId === 'legacy' ? { batchId: null } : { batchId: options.batchId }) : {})
                    } 
                },
                competitors: true
            }
        });

        if (!brand) throw new Error("Brand not found");
        if (!brand.queries || brand.queries.length === 0) {
            throw new Error("No active queries found for brand. Cannot run scan.");
        }

        const batches = chunkArray(brand.queries, BATCH_SIZE);
        const createdResponses = [];
        const models = options.models && options.models.length > 0 ? options.models : ['gemini-3.1-flash-lite'];

        console.log(`Scanning "${brand.name}" — ${brand.queries.length} queries across ${models.length} model(s) in ${batches.length} batch(es) per model`);

        for (const model of models) {
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];

                const batchResults = await getBatchAiResponses(
                    batch.map(q => ({ id: q.id, text: q.text })),
                    model
                );

                // Detect + commit each response immediately (resilient to mid-scan failures)
                for (const result of batchResults) {
                    const detection = await runDetection(result.response, brand, brand.competitors);

                    const response = await prisma.aiResponse.create({
                        data: {
                            scanId:            scan.id,
                            queryId:           result.queryId,
                            aiModel:           model,
                            content:           result.response,
                            responseStructure: detection.responseStructure,
                            // queryScore written back after scoring
                            mentions: {
                                create: detection.mentions.map(m => ({
                                    brandId:        m.brandId,
                                    competitorId:   m.competitorId,
                                    rankPosition:   m.rankPosition,
                                    sentiment:      m.sentiment,
                                    mentionContext: m.mentionContext,
                                    mentionType:    m.mentionType,
                                    characterIndex: m.characterIndex,
                                    isInList:       m.isInList
                                }))
                            }
                        },
                        include: { mentions: true, query: true }
                    });
                    createdResponses.push(response);
                }
            }
        }

        const scoreDataOverall = calculateVisibilityScore(createdResponses, brand.id, brand.competitors);

        const byModel = {};
        let sumBrandScore = 0;
        for (const model of models) {
            const modelResponses = createdResponses.filter(r => r.aiModel === model);
            if (modelResponses.length > 0) {
                const modelScoreData = calculateVisibilityScore(modelResponses, brand.id, brand.competitors);
                byModel[model] = modelScoreData.brandScore;
                sumBrandScore += modelScoreData.brandScore;
            } else {
                byModel[model] = 0;
            }
        }
        const finalVisibilityScore = models.length > 0 ? sumBrandScore / models.length : scoreDataOverall.brandScore;

        // Write per-query scores back to each AiResponse record
        await Promise.all(
            createdResponses.map(r =>
                prisma.aiResponse.update({
                    where: { id: r.id },
                    data:  { queryScore: scoreDataOverall.queryScores[r.id] ?? 0 }
                })
            )
        );

        const completedScan = await prisma.scan.update({
            where: { id: scan.id },
            data: { status: 'COMPLETED', visibilityScore: finalVisibilityScore },
            include: {
                aiResponses: { include: { mentions: true } }
            }
        });

        // Attach enriched scoring info to the response
        completedScan.scoring = {
            overall:         finalVisibilityScore,
            byModel:         byModel,
            brandName:       brand.name,
            brandScore:      finalVisibilityScore, // preserve for UI
            brandAvgRank:    scoreDataOverall.brandAvgRank,
            intentBreakdown: scoreDataOverall.intentBreakdown,
            competitors: brand.competitors.map(c => ({
                id:      c.id,
                name:    c.name,
                score:   scoreDataOverall.competitorScores[c.id] || 0,
                avgRank: scoreDataOverall.competitorAvgRanks[c.id] || null
            }))
        };

        return completedScan;

    } catch (error) {
        console.error("Scan Failed:", error);
        if (scan && scan.id) {
            try {
                await prisma.scan.update({
                    where: { id: scan.id },
                    data: { status: 'FAILED', failureReason: error.message || 'Unknown error' }
                });
            } catch (updateErr) {
                console.error("Could not update scan status to FAILED:", updateErr.message);
            }
        }
        throw error;
    }
}

module.exports = { runScan };
