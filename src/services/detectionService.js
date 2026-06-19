// Detection service — heuristic-based, no LLM calls

// ---------------------------------------------------------------------------
// 1. extractMentionContext
// ---------------------------------------------------------------------------
/**
 * Returns up to 150 characters before and after each occurrence of entityName
 * found in the response text.
 * @returns {string|null} — the first context window, or null if not found
 */
function extractMentionContext(responseText, entityName) {
    const lowerText = responseText.toLowerCase();
    const lowerName = entityName.toLowerCase();
    const index = lowerText.indexOf(lowerName);
    if (index === -1) return null;

    const start = Math.max(0, index - 150);
    const end   = Math.min(responseText.length, index + entityName.length + 150);
    return responseText.substring(start, end);
}

// ---------------------------------------------------------------------------
// 2. detectResponseStructure
// ---------------------------------------------------------------------------
/**
 * Inspects the AI response text for formatting patterns and returns one of:
 *   NUMBERED_LIST | BULLET_LIST | SOLE_RECOMMENDATION | PARAGRAPH | MIXED
 */
function detectResponseStructure(responseText) {
    const hasNumberedList = /^\s*\d+[\.\)]\s+/m.test(responseText);
    const hasBulletList   = /^\s*[-*•]\s+/m.test(responseText);

    if (hasNumberedList && hasBulletList)  return 'MIXED';
    if (hasNumberedList || hasBulletList)  return 'LIST';

    // Check for table-like structure (markdown tables)
    if (/^\s*\|.+\|/m.test(responseText))  return 'TABLE';

    return 'PARAGRAPH';
}

// ---------------------------------------------------------------------------
// 3. classifyMentionType (heuristic — no LLM call)
// ---------------------------------------------------------------------------
/**
 * Classifies how a brand/competitor is mentioned using fast heuristics
 * instead of an LLM call.
 *
 * Rules:
 *   - SOLE_RECOMMENDATION:   only 1 entity found in entire response
 *   - DIRECT_RECOMMENDATION: entity is ranked #1 in a list/table response
 *   - COMPARISON:            2+ entities found in the response
 *   - WARNING:               negative keywords near the mention
 *   - CASUAL_MENTION:        default fallback
 */
function classifyMentionTypeHeuristic(mention, allMentions, responseStructure) {
    // Only entity mentioned → sole recommendation
    if (allMentions.length === 1) return 'SOLE_RECOMMENDATION';

    // Check for negative signals in context
    if (mention.mentionContext) {
        const ctxLower = mention.mentionContext.toLowerCase();
        const negativePatterns = ['avoid', 'drawback', 'downside', 'limitation', 'not recommend', 'worse', 'inferior', 'beware'];
        if (negativePatterns.some(p => ctxLower.includes(p))) return 'WARNING';
    }

    // Multiple entities → depends on rank and structure
    if (allMentions.length >= 2) {
        const isListLike = responseStructure === 'LIST' || responseStructure === 'MIXED' || responseStructure === 'TABLE';

        // Ranked #1 in a structured list → direct recommendation
        if (mention.rankPosition === 1 && isListLike) return 'DIRECT_RECOMMENDATION';

        return 'COMPARISON';
    }

    return 'CASUAL_MENTION';
}

// ---------------------------------------------------------------------------
// 4. runDetection  (optimized — no LLM calls, pure heuristics)
// ---------------------------------------------------------------------------
/**
 * Detects mentions, ranking position, and sentiment from AI response text.
 * Uses heuristic-based classification (no LLM calls) for speed.
 */
async function runDetection(responseText, brand, competitors) {
    const textLower = responseText.toLowerCase();
    const mentions = [];

    // Match entities (brands + competitors)
    const entities = [
        { entityId: brand.id, name: brand.name, type: 'BRAND' },
        ...competitors.map(c => ({ entityId: c.id, name: c.name, type: 'COMPETITOR' }))
    ];

    // Detect response structure once per response
    const structure = detectResponseStructure(responseText);
    const isInListResponse = structure === 'LIST' || structure === 'MIXED' || structure === 'TABLE';

    for (const entity of entities) {
        const index = textLower.indexOf(entity.name.toLowerCase());
        if (index !== -1) {
            const contextWindow = extractMentionContext(responseText, entity.name);

            mentions.push({
                brandId:       entity.type === 'BRAND'      ? entity.entityId : null,
                competitorId:  entity.type === 'COMPETITOR' ? entity.entityId : null,
                rankPosition:  1, // placeholder, assigned below
                sentiment:     'POSITIVE',
                characterIndex: index,
                isInList:       isInListResponse,
                mentionContext: contextWindow
            });
        }
    }

    // Sort by appearance in text to assign relative rank
    mentions.sort((a, b) => a.characterIndex - b.characterIndex);
    mentions.forEach((m, idx) => {
        m.rankPosition = idx + 1;
    });

    // Classify mention types via heuristics (instant, no API calls)
    mentions.forEach(m => {
        m.mentionType = classifyMentionTypeHeuristic(m, mentions, structure);
    });

    return { mentions, responseStructure: structure };
}

module.exports = {
    runDetection,
    extractMentionContext,
    detectResponseStructure,
    classifyMentionTypeHeuristic
};
