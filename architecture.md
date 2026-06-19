# AI Visibility Tracker Architecture

This is a living document outlining the architecture of the AI Visibility Tracker application. It should be updated whenever major structural changes or new components are introduced.

## Core Stack

- **Backend Framework:** Node.js with Express.js
- **Database:** PostgreSQL (running via Docker locally)
- **ORM:** Prisma (using the `@prisma/adapter-pg` driver adapter)
- **AI Integration:** Google Gemini API (`@google/genai`)
- **Frontend:** Vanilla HTML/CSS/JS (served statically via Express `public/` directory)

## Data Models (Prisma Schema)

The core domain relies on these relationships:

1. **Brand:** The focal point of tracking. Has a UUID, name, and industry.
2. **Competitor:** Associated with a Brand. Enables vs. tracking.
3. **Query:** SEO keywords/prompts generated for a Brand.
4. **Scan:** A snapshot execution that tests a Brand against all its Queries using an AI model.
5. **AiResponse:** The raw structured output from the LLM for a specific Query during a Scan.
6. **Mention:** Extracted entities (Brand or Competitor) from an `AiResponse`, including their rank position (1st, 2nd, etc.) and sentiment.

## Backend Services Architecture

The backend is modularized into distinct services to separate concerns:

### 1. Route Controllers (`src/routes/`)
- `brandRoutes.js`: Handles creating Brands and Competitors, fetching score history.
- `queryRoutes.js`: Handles manual query creation, fetching queries, and triggering AI query generation.
- `scanRoutes.js`: Handles triggering new scans and fetching the latest scan snapshot.

### 2. Core Business Logic (`src/services/`)
- **`scanService.js` (Execution Engine):** Orchestrates the full visibility scan. It fetches queries, coordinates AI calls, runs detection logic, calculates the final visibility score, and updates the database.
- **`aiService.js` (LLM Integration):** Encapsulates all communication with Google Gemini. Contains optimized prompts for querying the model (e.g., "return a flat JSON array of strings"). Handles fallbacks/mocking when API keys are absent.
- **`queryService.js` (Query Engine):** Handles the automated generation of niche-generic SEO queries. Uses a two-phase AI prompt strategy: Phase 1 internally researches the brand's niche/category/audience, Phase 2 generates 50 generic queries that never mention the brand name. Includes a post-generation safety filter and batch database insertions with O(1) duplicate detection.

## Key System Flows

### Flow 1: Entity Setup & Query Generation
1. **User Input:** User enters Brand Name, Industry, and Competitor on the Dashboard.
2. **Setup:** `POST /brands` saves the Brand and Competitor.
3. **Generation Trigger:** User clicks "Auto-Populate", triggering `POST /queries/generate`.
4. **AI Generation:** `queryService` calls `aiService` to generate 50 high-intent queries based on the Brand and Industry.
5. **Storage:** `queryService` deduplicates and batch inserts the queries.

### Flow 2: Full Visibility Scan Execution
1. **Trigger:** User clicks "Run Full Scan" (`POST /scan/:brandId/run`).
2. **Initialization:** `scanService` creates a new Scan record in `PROCESSING` state.
3. **Batching:** Queries are chunked into batches of 10 using `chunkArray()`.
4. **Batch Processing:** For each batch (5 iterations for 50 queries):
   - Calls `aiService.getBatchAiResponses(batch)` — sends all 10 queries in a single API call.
   - The AI returns a structured JSON array with one response per query.
   - Each individual response is run through the detection pipeline for Mentions.
   - Saves `AiResponse` and `Mention` records.
5. **Scoring:** Aggregates mention ranks into a final `visibilityScore` (0-100%).
6. **Completion:** Updates the Scan record to `COMPLETED` with the calculated score.

## Frontend Interaction (Dashboard)

- A single-page application (`public/index.html`) using Glassmorphism styling.
- **Dynamic Context:** Swaps backend tracking targets dynamically when a new Brand is configured.
- **Live Updating:** Fetches and displays generated queries from the DB organically after generation.
- **Detailed Insights:** A floating JavaScript modal parses deep-nested Prisma objects (Scan -> AiResponses -> Mentions -> Query string) to show a detailed breakdown of which competitor won each individual query prompt.
