/**
 * Minimum multiplier for any actual mention is 0.2 — a brand appearing
 * in a response should never score identical to a brand not appearing at all.
 *
 * Returns a mention-type multiplier for the brand score.
 *
 * mentionType values (from detectionService / DB):
 *   SOLE_RECOMMENDATION   → hero mention    (1.5x)
 *   DIRECT_RECOMMENDATION → full points     (1.0x)
 *   FEATURED_SNIPPET      → prominent       (1.3x)
 *   CASUAL_MENTION        → neutral         (0.5x)
 *   COMPARISON            → depends on rank relative to competitors —
 *                           if brand ranked 1st among all mentioned: 1.2x (COMPARISON_WINNER)
 *                           otherwise: 0.2x (COMPARISON_LOSER — still appeared)
 *   WARNING               → negative signal (0x)
 *
 * sentiment-based overrides (when mentionType is absent):
 *   NEGATIVE → 0x
 *   NEUTRAL  → 0.5x
 *   POSITIVE → 1.0x
 */
function getMentionMultiplier(mention, allMentions) {
    const type = mention.mentionType;

    if (type === 'SOLE_RECOMMENDATION') return 1.5;
    if (type === 'DIRECT_RECOMMENDATION') return 1.0;
    if (type === 'FEATURED_SNIPPET') return 1.3;

    if (type === 'COMPARISON') {
        // COMPARISON_WINNER: brand is ranked higher than every competitor in this response
        const competitorMentions = allMentions.filter(m => m.competitorId);
        const allCompetitorsBelow = competitorMentions.every(
            cm => cm.rankPosition > mention.rankPosition
        );
        // Minimum 0.2 — a brand appearing in a response should never score
        // identical to a brand not appearing at all.
        return allCompetitorsBelow ? 1.2 : 0.2;
    }

    if (type === 'CASUAL_MENTION') return 0.5;
    if (type === 'WARNING') return 0;

    // Fallback to sentiment when mentionType is null / unset
    if (mention.sentiment === 'NEGATIVE') return 0;
    if (mention.sentiment === 'NEUTRAL') return 0.5;

    return 1.0; // POSITIVE or unknown → full value
}

/**
 * Computes the raw score (0-100) for a single brand mention in one query response.
 * Applies rank bonuses, competitive penalty, and mention-type multiplier.
 */
function calcRawQueryScore(brandMention, allMentions) {
    let base = 50; // presence bonus
    if (brandMention.rankPosition === 1) base += 50;
    else if (brandMention.rankPosition === 2) base += 30;
    else base += 10;

    // Penalise for each competitor ranked above the brand
    const higherRankedCompetitors = allMentions.filter(
        m => m.competitorId && m.rankPosition < brandMention.rankPosition
    );
    base -= higherRankedCompetitors.length * 10;
    base = Math.max(0, base);

    const multiplier = getMentionMultiplier(brandMention, allMentions);
    return parseFloat((base * multiplier).toFixed(2));
}

/**
 * Calculate visibility scores and average ranks for brand AND competitors.
 *
 * Returns: {
 *   brandScore:          number,          // 0-100 percentage
 *   competitorScores:    { [competitorId]: number },
 *   brandAvgRank:        number | null,
 *   competitorAvgRanks:  { [competitorId]: number | null },
 *   queryScores:         { [aiResponseId]: number },  // per-response brand score
 *   intentBreakdown:     { [queryIntent]: { score, count } }
 * }
 */
function calculateVisibilityScore(scannedResponses, brandId, competitors = []) {
    if (!scannedResponses || scannedResponses.length === 0) {
        return {
            brandScore: 0,
            competitorScores: {},
            brandAvgRank: null,
            competitorAvgRanks: {},
            queryScores: {},
            intentBreakdown: {}
        };
    }

    const totalQueries = scannedResponses.length;
    const maxPossibleScore = totalQueries * 100;

    // Brand tracking
    let brandTotalScore = 0;
    let brandRankSum = 0;
    let brandRankCount = 0;
    const queryScores = {};  // aiResponseId → computed brand score for that response
    const intentBuckets = {};  // queryIntent  → { total, count }

    // Competitor tracking
    const compStats = {};
    for (const comp of competitors) {
        compStats[comp.id] = { totalScore: 0, rankSum: 0, rankCount: 0 };
    }

    for (const response of scannedResponses) {
        const mentions = response.mentions || [];
        const intent = response.query?.queryIntent || 'UNCLASSIFIED';

        // --- Brand scoring ---
        const brandMention = mentions.find(m => m.brandId === brandId);
        let queryBrandScore = 0;

        if (brandMention) {
            queryBrandScore = calcRawQueryScore(brandMention, mentions);
            brandTotalScore += queryBrandScore;
            brandRankSum += brandMention.rankPosition;
            brandRankCount++;
        }

        // Store per-response score (used to write back to AiResponse.queryScore)
        queryScores[response.id] = parseFloat(Math.min(100, queryBrandScore).toFixed(2));

        // Accumulate intent breakdown
        if (!intentBuckets[intent]) intentBuckets[intent] = { total: 0, count: 0 };
        intentBuckets[intent].total += queryBrandScore;
        intentBuckets[intent].count++;

        // --- Competitor scoring (same logic, mirrored) ---
        for (const comp of competitors) {
            const compMention = mentions.find(m => m.competitorId === comp.id);
            if (compMention && compStats[comp.id]) {
                let compBase = 50;
                if (compMention.rankPosition === 1) compBase += 50;
                else if (compMention.rankPosition === 2) compBase += 30;
                else compBase += 10;

                const higherRankedBrand = mentions.filter(
                    m => m.brandId && m.rankPosition < compMention.rankPosition
                );
                compBase -= higherRankedBrand.length * 10;

                const compMultiplier = getMentionMultiplier(compMention, mentions);
                const compScore = Math.max(0, parseFloat((compBase * compMultiplier).toFixed(2)));

                compStats[comp.id].totalScore += compScore;
                compStats[comp.id].rankSum += compMention.rankPosition;
                compStats[comp.id].rankCount++;
            }
        }
    }

    // Build aggregate brand score
    const brandScore = parseFloat(((brandTotalScore / maxPossibleScore) * 100).toFixed(2));
    const brandAvgRank = brandRankCount > 0
        ? parseFloat((brandRankSum / brandRankCount).toFixed(2))
        : null;

    // Build competitor scores
    const competitorScores = {};
    const competitorAvgRanks = {};
    for (const comp of competitors) {
        const stats = compStats[comp.id];
        competitorScores[comp.id] = parseFloat(((stats.totalScore / maxPossibleScore) * 100).toFixed(2));
        competitorAvgRanks[comp.id] = stats.rankCount > 0
            ? parseFloat((stats.rankSum / stats.rankCount).toFixed(2))
            : null;
    }

    // Build intent breakdown: average score per intent group
    const intentBreakdown = {};
    for (const [intent, bucket] of Object.entries(intentBuckets)) {
        intentBreakdown[intent] = {
            avgScore: parseFloat((bucket.total / bucket.count).toFixed(2)),
            queryCount: bucket.count
        };
    }

    return {
        brandScore,
        competitorScores,
        brandAvgRank,
        competitorAvgRanks,
        queryScores,
        intentBreakdown
    };
}

module.exports = { calculateVisibilityScore };
