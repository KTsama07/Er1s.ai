const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'dummy_for_testing' });

const RATE_LIMIT_RPM = 14;
const DELAY_MS = Math.ceil((60 / RATE_LIMIT_RPM) * 1000); // ~4286ms

let lastCallTime = 0;
let queue = Promise.resolve();

/**
 * Wraps Gemini's generateContent to strictly enforce 14 RPM limit.
 */
async function rateLimitedGenerateContent(params) {
    return new Promise((resolve, reject) => {
        queue = queue.then(async () => {
            const now = Date.now();
            const timeSinceLastCall = now - lastCallTime;
            const waitTime = Math.max(0, DELAY_MS - timeSinceLastCall);
            
            if (waitTime > 0) {
                await new Promise(r => setTimeout(r, waitTime));
            }
            
            try {
                const result = await ai.models.generateContent(params);
                lastCallTime = Date.now();
                resolve(result);
            } catch (err) {
                lastCallTime = Date.now();
                reject(err);
            }
        });
    });
}

module.exports = { rateLimitedGenerateContent, ai };
