const { OpenAI } = require('openai');
const { rateLimitedGenerateContent } = require('./rateLimiter');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy_for_testing' });

/**
 * Calls the AI provider to get a response to a given query.
 */
async function getAiResponse(queryText, model = 'gemini-3.1-flash-lite') {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.warn("No GEMINI_API_KEY found. Returning mocked response for MVP.");
            return `Here is a review of meal kits. Number 1: FreshPrep. Number 2: HelloFresh. Both are great.`;
        }

        const response = await rateLimitedGenerateContent({
            model: model,
            contents: queryText,
        });

        return response.text;
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
}

/**
 * Calls OpenAI to get a response to a given query.
 */
async function getOpenAiResponse(queryText) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === '') {
        console.warn("No OPENAI_API_KEY found. Returning mocked response for MVP.");
        return `Here are some recommendations using OpenAI. FreshPrep is highly recommended. HelloFresh is also a good alternative to consider.`;
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a helpful assistant. Answer the user's question with specific tool and brand recommendations where relevant." },
                { role: "user", content: queryText }
            ]
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error("OpenAI API Error:", error);
        throw error;
    }
}

/**
 * Generates 50 niche-generic high-intent queries.
 * 
 * Strategy: The AI first internally researches the brand to understand its
 * niche, category, and use-cases. It then generates queries a real user
 * would search when looking for solutions in that space — WITHOUT ever
 * mentioning the brand name. This produces honest visibility tracking
 * because the AI must organically recall and recommend the brand.
 */
async function generateQueries(brandName, industry, competitors, generatorModel = 'gemini-3.1-flash-lite', perspective = null) {
    const perspectiveBlock = perspective
        ? `- Target Customer / Perspective: ${perspective}\n- IMPORTANT: All queries must be written from the perspective of a "${perspective}" searching for solutions. Frame queries around the specific needs, pain points, and decision criteria of this audience.`
        : '';

    const prompt = `
You are an expert SEO and AI Engine Optimization (AEO) strategist specializing in technology and B2B/B2C products.

CRITICAL CONTEXT — READ BEFORE ANYTHING ELSE:
- Brand: "${brandName}"
- Industry / Category: ${industry}
${perspectiveBlock}
- IMPORTANT: Ignore any other businesses or products that may share a similar name. You are ONLY researching this brand in the context of ${industry}.

PHASE 1 — INTERNAL RESEARCH (do NOT output this phase):
Confirm your understanding: "${brandName} is a product in the ${industry} space."
Now analyze:
- What specific problem does this solve?
- What are the common pain points of its target audience${perspective ? ` (specifically: ${perspective})` : ''}?
- What queries would a ${perspective ? perspective : 'user'} type when looking for solutions in ${industry}?

PHASE 2 — SELF-CHECK (do NOT output this phase):
Review each planned query and ask yourself:
- Are ALL queries relevant to ${industry}?
${perspective ? `- Are ALL queries written from the perspective of a "${perspective}"?\n` : ''}- Would the answer to each query naturally recommend tools or services in this space?
- Does any query belong to a different industry or unrelated domain? If yes, replace it.
- CRITICAL: Would an AI respond to this query with a specific list of 3-5 tools/brands, or with a generic educational paragraph?
  → If the answer is an educational paragraph, REWRITE the query until it would trigger a tool recommendation.

PHASE 3 — QUERY GENERATION (output ONLY this phase):
Generate exactly 20 high-commercial-intent search queries that a real ${perspective ? perspective : 'user'} would type when looking for a ${industry} solution.

STRICT RULES:
- NEVER include "${brandName}" or any competitor name in any query
- Every single query must be relevant to ${industry}
- Queries must be generic to the category, not brand-specific
${perspective ? `- Every query must reflect the needs, language, and priorities of a "${perspective}"\n` : ''}- Every query must be phrased to elicit a TOOL RECOMMENDATION response, not an educational or explanatory response
- NEVER generate queries starting with "what is", "what are", "how does", "explain", "why do", "what does" — these trigger educational responses where AI lists generic categories instead of specific brands
- PREFER queries starting with: "best", "top", "which tool", "compare", "vs", "alternative to", or "[specific use case] tool/platform/software"
- Every query must pass this internal test: "Would an AI respond to this by naming 3-5 specific tools or brands?" — if not, rewrite it until it would
- Mix these intent clusters (10 queries each):
  1. Tool discovery — e.g. "best tools for [specific task]"
  2. Comparison/alternatives — e.g. "top alternatives to [popular competitor] for ${industry}"
  3. Use-case specific — e.g. "best software for [specific audience] with no coding experience"
  4. Decision-making — e.g. "which platform is best for [specific scenario]"
  5. Feature-driven — e.g. "tools with [specific feature] for [specific audience]"

OUTPUT FORMAT:
Return strictly a flat JSON array of 20 query strings.
No markdown, no explanation, no preamble.
`;

    try {
        if (!process.env.GEMINI_API_KEY && generatorModel.includes('gemini')) {
            console.warn("No GEMINI_API_KEY found. Returning mocked niche queries for MVP.");
            return [`best tools for ${industry}`, `how to choose the right ${industry} platform`];
        }
        if (!process.env.OPENAI_API_KEY && generatorModel.includes('gpt')) {
            console.warn("No OPENAI_API_KEY found. Returning mocked niche queries for MVP.");
            return [`best ${industry} solutions`, `top rated ${industry} software`];
        }

        let queriesText = "";

        if (generatorModel === 'gpt-4o-mini') {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }]
            });
            queriesText = completion.choices[0].message.content;
        } else {
            const response = await rateLimitedGenerateContent({
                model: generatorModel,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });
            queriesText = response.text;
        }

        queriesText = queriesText.replace(/```json/g, '').replace(/```/g, '').trim();
        let queries;
        try {
            queries = JSON.parse(queriesText);
            if (!Array.isArray(queries)) throw new Error("Output was not an array");
        } catch (err) {
            console.error("Failed to parse LLM output:", queriesText);
            throw new Error("Failed to parse AI output into valid JSON array");
        }

        // Safety filter: strip any query that accidentally contains the brand name
        const brandLower = brandName.toLowerCase();
        queries = queries.filter(q => typeof q === 'string' && !q.toLowerCase().includes(brandLower));

        return queries;

    } catch (error) {
        console.error("AI API Query Generation Error:", error);
        throw error;
    }
}

/**
 * Validates a generated query list against the specified industry and category
 * by sending it back to the model for a quality gate check.
 *
 * @returns {{ valid: boolean, irrelevantQueries: string[], reason: string }}
 */
async function validateQueries(queries, industry, generatorModel = 'gemini-3.1-flash-lite') {
    if (!process.env.GEMINI_API_KEY && generatorModel.includes('gemini')) return { valid: true, irrelevantQueries: [], reason: 'Skipped (no API key)' };
    if (!process.env.OPENAI_API_KEY && generatorModel.includes('gpt')) return { valid: true, irrelevantQueries: [], reason: 'Skipped (no API key)' };

    const validationPrompt = `You are a query quality validator for AI Engine Optimization (AEO).
Given this industry: "${industry}", review this query list and return a JSON object.

Check TWO things:
1. RELEVANCE: Are all queries genuinely relevant to ${industry}?
2. RECOMMENDATION INTENT: Would an AI assistant respond to each query by naming 3-5 specific tools or brands?
   - Queries starting with "what is", "what are", "how does", "explain", "why do" almost always trigger educational paragraph responses, NOT tool recommendations. These are BAD.
   - Queries starting with "best", "top", "which tool", "compare", "vs", "alternative to" reliably trigger tool recommendations. These are GOOD.

Return format:
{ "valid": boolean, "irrelevantQueries": string[], "informationalQueries": string[], "triggersRecommendations": boolean, "reason": string }

- "valid": false if ANY queries are irrelevant to ${industry}, OR if more than 5 queries would trigger educational/explanatory responses instead of tool recommendations.
- "irrelevantQueries": list queries that don't belong to ${industry}.
- "informationalQueries": list queries that would trigger educational responses instead of tool/brand recommendations.
- "triggersRecommendations": true only if the MAJORITY of queries would make an AI name specific tools or brands.
- "reason": brief explanation. If valid is false due to informational queries, set reason to: "Too many informational queries - queries must elicit brand recommendations".

Queries to validate:
${JSON.stringify(queries, null, 2)}`;

    try {
        let parsed;

        if (generatorModel === 'gpt-4o-mini') {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [{ role: "user", content: validationPrompt }]
            });
            parsed = JSON.parse(completion.choices[0].message.content.trim());
        } else {
            const response = await rateLimitedGenerateContent({
                model: 'gemini-3.1-flash-lite', // We keep flash-lite for validation since it's cheap/fast and has struct gen
                contents: validationPrompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            valid:                  { type: 'BOOLEAN' },
                            irrelevantQueries:      { type: 'ARRAY', items: { type: 'STRING' } },
                            informationalQueries:   { type: 'ARRAY', items: { type: 'STRING' } },
                            triggersRecommendations:{ type: 'BOOLEAN' },
                            reason:                 { type: 'STRING' }
                        },
                        required: ['valid', 'irrelevantQueries', 'informationalQueries', 'triggersRecommendations', 'reason']
                    }
                }
            });
            parsed = JSON.parse(response.text);
        }

        return {
            valid:                   parsed.valid                   ?? true,
            irrelevantQueries:       parsed.irrelevantQueries       ?? [],
            informationalQueries:    parsed.informationalQueries    ?? [],
            triggersRecommendations: parsed.triggersRecommendations ?? true,
            reason:                  parsed.reason                  ?? ''
        };
    } catch (err) {
        console.warn('  ⚠ validateQueries failed, defaulting to valid=true:', err.message);
        return { valid: true, irrelevantQueries: [], reason: 'Validation skipped due to error' };
    }
}


/**
 * Sends a batch of queries in a SINGLE API call and returns per-query responses.
 * Instead of 1 call per query, we pack 10 queries into 1 prompt.
 * 
 * @param {Array<{id: string, text: string}>} queries - Array of query objects
 * @param {string} model - AI model to use
 * @returns {Array<{queryId: string, queryText: string, response: string}>}
 */
async function getBatchAiResponses(queries, model = 'gemini-3.1-flash-lite') {
    if (!queries || queries.length === 0) return [];

    if (model === 'gpt-4o-mini') {
        const results = await Promise.all(queries.map(async (q) => {
            const responseText = await getOpenAiResponse(q.text);
            return {
                queryId: q.id,
                queryText: q.text,
                response: responseText
            };
        }));
        return results;
    }

    const numberedQueries = queries.map((q, i) => `${i + 1}. ${q.text}`).join('\n');

    const prompt = `
You are a knowledgeable AI assistant. Answer each of the following questions independently.
For each question, provide a helpful, detailed response as if a user asked you directly.
Naturally mention and recommend relevant tools, platforms, brands, or products where appropriate.

QUESTIONS:
${numberedQueries}

STRICT OUTPUT RULES:
1. Return ONLY a valid JSON array. No markdown fences, no commentary before/after.
2. Each element: { "index": <1-based integer>, "response": "<answer text>" }
3. Keep each response to 2-3 concise paragraphs. Do NOT use bullet points, numbered lists, or multi-line formatting.
4. Write each response as flowing prose in a SINGLE paragraph block.
`;

    try {
        if (!process.env.GEMINI_API_KEY) {
            console.warn("No GEMINI_API_KEY. Returning mocked batch responses.");
            return queries.map(q => ({
                queryId: q.id,
                queryText: q.text,
                response: `Here are the top tools in this space. Number 1: FreshPrep is highly recommended. Number 2: HelloFresh is also popular.`
            }));
        }

        console.log(`  → Batch API call: ${queries.length} queries in one request...`);

        // Layer 1: Use Gemini's responseSchema + retry with exponential backoff
        const MAX_RETRIES = 3;
        let response;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                response = await rateLimitedGenerateContent({
                    model,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    index: { type: "INTEGER" },
                                    response: { type: "STRING" }
                                },
                                required: ["index", "response"]
                            }
                        }
                    }
                });
                break; // Success — exit retry loop
            } catch (apiErr) {
                const status = apiErr.status || apiErr.code;
                if ((status === 503 || status === 429) && attempt < MAX_RETRIES) {
                    const delay = 3000 * Math.pow(2, attempt - 1); // 3s, 6s, 12s
                    console.warn(`  ⚠ Gemini ${status} on attempt ${attempt}/${MAX_RETRIES}. Retrying in ${delay / 1000}s...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw apiErr; // Non-retryable or exhausted retries
                }
            }
        }

        let parsed = tryParseResponse(response.text);

        if (!parsed) {
            console.error("ALL parse strategies failed. Raw output (first 800 chars):", response.text.substring(0, 800));
            throw new Error("Failed to parse batched AI output into valid JSON array");
        }

        console.log(`  ✓ Parsed ${parsed.length} responses successfully`);

        // Map parsed responses back to their original query IDs
        return queries.map((q, i) => {
            const match = parsed.find(p => p.index === i + 1);
            return {
                queryId: q.id,
                queryText: q.text,
                response: match ? match.response : `[No response generated for query: ${q.text}]`
            };
        });

    } catch (error) {
        console.error("Gemini Batch API Error:", error);
        throw error;
    }
}

/**
 * Multi-stage JSON parser with fallback strategies.
 * Returns parsed array or null if all strategies fail.
 */
function tryParseResponse(rawText) {
    // Strategy 1: Direct parse (works when Gemini returns clean JSON)
    try {
        const direct = JSON.parse(rawText);
        if (Array.isArray(direct)) return direct;
    } catch (_) { }

    // Strategy 2: Sanitize + bracket extraction
    try {
        let text = rawText
            .replace(/```json/g, '').replace(/```/g, '')  // Strip markdown fences
            .trim();

        // Extract only the [...] portion
        const first = text.indexOf('[');
        const last = text.lastIndexOf(']');
        if (first !== -1 && last > first) {
            text = text.substring(first, last + 1);
        }

        // Replace literal control characters inside string values
        // (tabs, carriage returns, newlines that aren't already escaped)
        text = text
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // strip rare control chars
            .replace(/\r\n/g, '\\n')  // Windows newlines
            .replace(/\r/g, '\\n')    // Old Mac newlines
            .replace(/\n/g, '\\n')    // Unix newlines → escaped
            .replace(/\t/g, '\\t');   // Tabs → escaped

        const sanitized = JSON.parse(text);
        if (Array.isArray(sanitized)) return sanitized;
    } catch (_) { }

    // Strategy 3: Regex extraction fallback — manually pull index+response pairs
    try {
        console.warn("  ⚠ Falling back to regex extraction...");
        const results = [];
        // Match patterns like "index": 1, "response": "..."
        const regex = /"index"\s*:\s*(\d+)\s*,\s*"response"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let match;
        while ((match = regex.exec(rawText)) !== null) {
            results.push({
                index: parseInt(match[1]),
                response: match[2]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\')
            });
        }
        if (results.length > 0) return results;
    } catch (_) { }

    return null; // All strategies failed
}

module.exports = { getAiResponse, generateQueries, validateQueries, getBatchAiResponses };
