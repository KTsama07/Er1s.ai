require('dotenv').config();
const prisma = require('../db');
const crypto = require('crypto');
const { generateQueries, validateQueries } = require('./aiService');

/**
 * Generates queries using AI and saves them into PostgreSQL, avoiding duplicates.
 * Now validates query relevance before saving. If validation fails, throws an error
 * with the irrelevant queries and reason logged to console.
 *
 * @param {string} brandId
 * @param {string} industry
 * @param {string} [category]    - e.g. "AI-powered app builder"
 * @param {string} [targetUser]  - e.g. "product managers and startup founders"
 * @param {string} [scanId]      - If provided, marks scan as FAILED on validation failure
 * @param {string} [generatorModel] - The model to use for generation (gemini or gpt)
 * @param {string} [perspective]   - Target customer/perspective (e.g. "startup founders", "enterprise CTOs")
 */
async function autoPopulateQueries(brandId, industry, scanId = null, generatorModel = 'gemini-3.1-flash-lite', perspective = null) {
    // 1. Fetch Brand Context
    const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        include: { competitors: true }
    });

    if (!brand) throw new Error(`Brand ${brandId} not found`);
    const competitorNames = brand.competitors.map(c => c.name);

    // 2. Generate Queries via AI (enriched prompt)
    console.log(`Generating queries for ${brand.name} in industry: ${industry}${perspective ? ` (perspective: ${perspective})` : ''} using ${generatorModel}...`);
    const generatedQueries = await generateQueries(brand.name, industry, competitorNames, generatorModel, perspective);

    // 3. Validate query relevance via LLM quality gate
    console.log(`  → Validating ${generatedQueries.length} queries for relevance...`);
    const validation = await validateQueries(generatedQueries, industry, generatorModel);

    if (!validation.valid) {
        console.warn(`  ⚠ Query validation FAILED for "${brand.name}":`, validation.reason);
        if (validation.irrelevantQueries.length > 0) {
            console.warn(`  ⚠ Irrelevant queries:\n${validation.irrelevantQueries.map(q => `    - ${q}`).join('\n')}`);
        }
        if (validation.informationalQueries && validation.informationalQueries.length > 0) {
            console.warn(`  ⚠ Informational (non-recommendation) queries:\n${validation.informationalQueries.map(q => `    - ${q}`).join('\n')}`);
        }

        // If a scan is in flight, mark it as FAILED with a reason
        if (scanId) {
            await prisma.scan.update({
                where: { id: scanId },
                data: {
                    status: 'FAILED',
                    failureReason: `Query validation failed: ${validation.reason}. Irrelevant queries: ${validation.irrelevantQueries.join('; ')}`
                }
            });
        }

        throw new Error(`Query validation failed: ${validation.reason}`);
    }

    console.log(`  ✓ All queries validated as relevant (${validation.reason})`);

    // 4. Fetch existing queries to prevent duplicates (O(1) lookup map)
    const existingQueries = await prisma.query.findMany({
        where: { brandId },
        select: { text: true }
    });

    // Create a Set for O(1) case-insensitive lookups
    const existingQuerySet = new Set(
        existingQueries.map(q => q.text.toLowerCase().trim())
    );

    // 5. Filter for only new, unique queries
    const newQueriesData = [];
    let skippedCount = 0;
    const batchId = crypto.randomUUID();

    for (const q of generatedQueries) {
        // Enforce basic type checking just in case LLM hallucinations bypass parsing
        if (typeof q !== 'string') continue;

        const normalizedText = q.toLowerCase().trim();

        // Prevent both DB duplicates AND duplicates within the AI generated list itself
        if (!existingQuerySet.has(normalizedText)) {
            newQueriesData.push({
                brandId,
                batchId,
                text: q
            });
            existingQuerySet.add(normalizedText); // Add to set to catch inline duplicates
        } else {
            skippedCount++;
        }
    }

    // 6. Batch Insert into PostgreSQL
    if (newQueriesData.length > 0) {
        await prisma.query.createMany({
            data: newQueriesData,
            skipDuplicates: true // Native Postgres safeguard
        });
    }

    return {
        message: 'Query generation complete',
        totalGenerated: generatedQueries.length,
        added: newQueriesData.length,
        skippedDuplicates: skippedCount,
        validation: {
            passed: validation.valid,
            reason: validation.reason
        }
    };
}

module.exports = { autoPopulateQueries };
