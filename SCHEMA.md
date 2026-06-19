# Agent 0 — AI Visibility Tracker: Schema & Architecture Document

> **Version:** 1.0 · **Last updated:** 2026-03-12  
> A system for tracking how visible a brand is inside AI-generated responses (ChatGPT, Gemini, etc.).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project File Structure](#2-project-file-structure)
3. [System Architecture](#3-system-architecture)
4. [API Routes Reference](#4-api-routes-reference)
5. [Data Pipelines](#5-data-pipelines)
6. [Database Schema (Prisma / PostgreSQL)](#6-database-schema-prisma--postgresql)
7. [Service Layer Reference](#7-service-layer-reference)
8. [Scoring Algorithm](#8-scoring-algorithm)
9. [Environment & Infrastructure](#9-environment--infrastructure)

---

## 1. Project Overview

Agent 0 is an **AI Engine Optimisation (AEO) MVP** — a Node.js/Express backend that:

1. Manages **brands** and their **competitors**.
2. AI-generates **50 high-intent queries** a real user would search in the brand's industry (never mentioning the brand by name).
3. Runs a **scan** — batching those queries through Gemini and collecting raw AI responses.
4. **Detects** brand and competitor mentions in the responses (rank, sentiment, mention type).
5. **Scores** brand visibility on a 0–100 scale, weighted by rank and mention quality.
6. Exposes **analytics** endpoints for time-series visibility trend data.
7. Serves a **single-page frontend** (`public/index.html`) for interacting with the system.

**Stack:** Node.js · Express · Prisma · PostgreSQL · Google Gemini API · Docker

---

## 2. Project File Structure

```
Agent 0/
├── index.js                      # App entry point — Express server bootstrap
├── package.json                  # Dependencies & npm scripts
├── docker-compose.yml            # Local PostgreSQL container definition
├── prisma.config.ts              # Prisma configuration
├── .env                          # Environment variables (API keys, DB URL)
├── .gitignore
│
├── prisma/
│   ├── schema.prisma             # Database models & enums (source of truth)
│   └── migrations/
│       ├── 20260312001054_enrich_visibility_schema/   # Added enriched mention fields
│       └── 20260312002702_add_scan_failure_reason/    # Added failureReason to Scan
│
├── src/
│   ├── db.js                     # Shared Prisma client instance
│   │
│   ├── routes/
│   │   ├── brandRoutes.js        # Brand CRUD + score history
│   │   ├── queryRoutes.js        # Query generation + manual query management
│   │   ├── scanRoutes.js         # Scan trigger + latest scan retrieval
│   │   └── analyticsRoutes.js    # Visibility trend analytics (raw SQL)
│   │
│   └── services/
│       ├── aiService.js          # Gemini API wrapper — generate/validate/batch queries
│       ├── queryService.js       # AI query generation + validation + DB persistence
│       ├── scanService.js        # Scan orchestration (batch API → detect → score → persist)
│       ├── detectionService.js   # Mention detection, structure classification, mention type
│       └── scoringService.js     # Visibility score algorithm (0–100)
│
└── public/
    └── index.html                # Frontend single-page app (served as static)
```

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLIENT (Browser)                          │
│                     public/index.html                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP Requests
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express Server (index.js)                      │
│                      PORT 3000                                   │
│                                                                 │
│  Middleware: CORS · JSON body parsing · Morgan (logging)        │
│  Static:     public/ → served at /                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                       Routes                             │   │
│  │  /brands          → brandRoutes.js                       │   │
│  │  /queries         → queryRoutes.js                       │   │
│  │  /scan/:brandId   → scanRoutes.js                        │   │
│  │  /api/brands      → analyticsRoutes.js                   │   │
│  │  /health          → inline healthcheck                   │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
┌─────────────────────┐      ┌────────────────────────────┐
│   Service Layer     │      │   Google Gemini API         │
│                     │      │                             │
│ aiService.js        │◄────►│  gemini-2.5-flash           │
│  - generateQueries  │      │   (main model — responses   │
│  - validateQueries  │      │    & query generation)      │
│  - getBatchAiRes.   │      │                             │
│                     │      │  gemini-2.0-flash           │
│ queryService.js     │◄────►│   (validation & mention     │
│ detectionService.js │      │    type classification)     │
│ scanService.js      │      └────────────────────────────┘
│ scoringService.js   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   PostgreSQL DB      │
│  (via Prisma ORM)    │
│                      │
│  Brand               │
│  Competitor          │
│  Query               │
│  Scan                │
│  AiResponse          │
│  Mention             │
│  ConversionEvent     │
└──────────────────────┘
```

---

## 4. API Routes Reference

### Brand Routes — `/brands`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/brands` | Create a brand with optional competitors array |
| `GET` | `/brands` | List all brands (with competitor count, query count) |
| `GET` | `/brands/:brandId/score-history` | All completed scan scores for a brand (chronological) |

**POST `/brands` body:**
```json
{
  "name": "Acme SaaS",
  "competitors": ["RivalCo", "AnotherTool"]
}
```

---

### Query Routes — `/queries`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/queries/generate` | AI-generate 50 queries + validate + persist |
| `POST` | `/queries` | Manually add a single query for a brand |
| `GET` | `/queries/:brandId` | List all queries for a brand |

**POST `/queries/generate` body:**
```json
{
  "brandId": "uuid",
  "industry": "B2B SaaS",
  "category": "AI-powered app builder",
  "targetUser": "product managers and startup founders"
}
```

---

### Scan Routes — `/scan/:brandId`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/scan/:brandId/run` | Run a full visibility scan (blocking, synchronous) |
| `GET` | `/scan/:brandId/latest` | Get the most recent scan with mentions |

**POST `/scan/:brandId/run` response:**
```json
{
  "message": "Scan completed successfully",
  "scanId": "uuid",
  "score": 72.5,
  "status": "COMPLETED",
  "scoring": {
    "brandName": "Acme SaaS",
    "brandScore": 72.5,
    "brandAvgRank": 1.4,
    "intentBreakdown": { "INFORMATIONAL": { "avgScore": 80, "queryCount": 12 } },
    "competitors": [{ "id": "uuid", "name": "RivalCo", "score": 55, "avgRank": 2.1 }]
  }
}
```

---

### Analytics Routes — `/api/brands`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/brands/:brandId/visibility-trend` | Dashboard analytics: weekly scores, intent breakdown, mention type trends, worst queries |

**Response shape:**
```json
{
  "brandId": "uuid",
  "generatedAt": "ISO timestamp",
  "weeklyScores": [{ "week_start": "date", "avg_visibility_score": 68.5, "scan_count": 3 }],
  "intentBreakdown": [{ "queryIntent": "COMMERCIAL", "avg_query_score": 75.0, "response_count": 10 }],
  "mentionTypeWeekly": [{ "week_start": "date", "mentionType": "DIRECT_RECOMMENDATION", "mention_count": 5 }],
  "worstQueries": { "scanId": "uuid", "results": [{ "query_text": "...", "queryScore": 10 }] }
}
```

---

## 5. Data Pipelines

### Pipeline 1 — Query Generation

```
Client  →  POST /queries/generate  →  queryService.autoPopulateQueries()
                                            │
                                ┌───────────┼──────────────────────────────┐
                                │           │                              │
                          1. Fetch brand    2. AI Generate 50 queries      │
                             + competitors     (aiService.generateQueries) │
                                │              ↓                           │
                                │        Gemini 2.5-flash                  │
                                │        3-phase prompt:                   │
                                │          Phase 1: Internal research      │
                                │          Phase 2: Self-check             │
                                │          Phase 3: Output JSON array      │
                                │              ↓                           │
                                │     Safety filter: strip any query       │
                                │     containing brand name                │
                                │              ↓                           │
                                │     3. Validate (aiService.validateQueries) │
                                │        Gemini 2.0-flash quality gate    │
                                │        → { valid, irrelevantQueries, reason } │
                                │              ↓                           │
                                │     [If INVALID] → throw error,          │
                                │       mark scan FAILED if scanId present │
                                │              ↓                           │
                                │     4. Dedup against existing DB queries │
                                │     5. Batch INSERT new queries          │
                                └──────────────────────────────────────────┘
                                              ↓
                                      Response: { added, skipped, validation }
```

---

### Pipeline 2 — Scan Execution

```
Client  →  POST /scan/:brandId/run  →  scanService.runScan(brandId)
                                              │
                    ┌─────────────────────────┼─────────────────────────────────┐
                    │                         │                                 │
              1. Create Scan              2. Load brand                  BATCH_SIZE = 10
                (status=PROCESSING)          + active queries                   │
                                             + competitors                      │
                                                  │                             │
                                     3. Chunk queries into batches (÷10)        │
                                                  │                             │
                                     ┌────────────▼──────────────────────┐      │
                                     │   For each batch (5 batches):     │      │
                                     │                                   │      │
                                     │   aiService.getBatchAiResponses() │      │
                                     │    → Single Gemini 2.5-flash call  │      │
                                     │      packing 10 queries            │      │
                                     │    → JSON array [{index, response}]│     │
                                     │    → Retry w/ exponential backoff  │     │
                                     │      (503/429: 3s → 6s → 12s)     │      │
                                     │    → 3-strategy JSON parser        │      │
                                     │      (direct → sanitize → regex)  │      │
                                     │                                   │      │
                                     │   For each response in batch:     │      │
                                     │   detectionService.runDetection() │      │
                                     │    → detectResponseStructure()    │      │
                                     │    → find entity mentions         │      │
                                     │    → extractMentionContext()      │      │
                                     │    → classifyMentionType()        │      │
                                     │      (Gemini 2.0-flash, parallel) │      │
                                     └────────────┬──────────────────────┘      │
                                                  │                             │
                                     4. Persist AiResponse + Mentions (Prisma)  │
                                                  │                             │
                                     5. scoringService.calculateVisibilityScore()
                                        → Score each query response (0–100)     │
                                        → Aggregate brand score                 │
                                        → Rank competitors                      │
                                        → Intent breakdown                      │
                                                  │                             │
                                     6. Update AiResponse.queryScore           │
                                     7. Update Scan: status=COMPLETED,         │
                                        visibilityScore = final 0-100 score    │
                                                  │                             │
                                     8. Return enriched scan + scoring summary │
```

---

### Pipeline 3 — Detection

```
AI Response Text
      │
      ├─► detectResponseStructure()
      │     regex patterns:
      │     - /^\s*\d+[.)]\s+/m  → NUMBERED_LIST
      │     - /^\s*[-*•]\s+/m    → BULLET_LIST
      │     - both               → MIXED
      │     - ≤2 sentences       → SOLE_RECOMMENDATION
      │     - else               → PARAGRAPH
      │
      ├─► Find entities (brand + competitors) by substring match
      │     → characterIndex (position of first match)
      │     → extractMentionContext() — 150 chars before/after
      │
      ├─► Sort mentions by characterIndex → assign rankPosition
      │
      └─► classifyMentionType() [async, parallel, Gemini 2.0-flash]
            prompt: context window → classify:
            - DIRECT_RECOMMENDATION
            - COMPARISON
            - CASUAL_MENTION
```

---

## 6. Database Schema (Prisma / PostgreSQL)

### Entity Relationship Diagram

```
Brand ──────────────────┬──── Competitor[]    (cascade delete)
  │                     │
  ├── Query[]           │──── Query[]          (cascade delete)
  │     └── AiResponse[]│
  │                     │──── Scan[]           (cascade delete)
  ├── Scan[]            │
  │     └── AiResponse[]│──── Mention[]        (direct, for quick lookups)
  │           ├── Mention[] (→ Brand or Competitor)
  │           └── query (Query join)
  └── Mention[]

ConversionEvent  (standalone — links to brandId + optional scanId)
```

### Model Definitions

#### `Brand`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `name` | `String` UNIQUE | |
| `createdAt` | `DateTime` | |
| `updatedAt` | `DateTime` | auto-updated |
| `competitors` | `Competitor[]` | |
| `queries` | `Query[]` | |
| `scans` | `Scan[]` | |
| `mentions` | `Mention[]` | direct relation for fast lookup |

#### `Competitor`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `name` | `String` | |
| `brandId` | `String` FK | cascade delete |
| `createdAt` | `DateTime` | |
| `mentions` | `Mention[]` | |
| **Unique** | `(name, brandId)` | no duplicate competitors per brand |
| **Index** | `brandId` | |

#### `Query`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `text` | `String` | query text |
| `brandId` | `String` FK | cascade delete |
| `isActive` | `Boolean` | default `true` |
| `queryIntent` | `QueryIntent?` | enum — optional classification |
| `createdAt` | `DateTime` | |
| `aiResponses` | `AiResponse[]` | |
| **Index** | `brandId` | |

#### `Scan`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `brandId` | `String` FK | cascade delete |
| `status` | `ScanStatus` | default `PENDING` |
| `visibilityScore` | `Float?` | populated on `COMPLETED` |
| `failureReason` | `String?` | populated on `FAILED` |
| `createdAt` | `DateTime` | |
| `aiResponses` | `AiResponse[]` | |
| **Index** | `brandId` | |
| **Index** | `createdAt` | for time-series queries |

#### `AiResponse`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `scanId` | `String` FK | cascade delete |
| `queryId` | `String` FK | cascade delete |
| `aiModel` | `String` | e.g. `'gemini-2.5-flash'` |
| `content` | `Text` | raw AI response text |
| `responseStructure` | `ResponseStructure?` | enum |
| `queryScore` | `Float?` | brand score for this response (0–100) |
| `createdAt` | `DateTime` | |
| `mentions` | `Mention[]` | |
| **Index** | `scanId`, `queryId` | |

#### `Mention`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `aiResponseId` | `String` FK | cascade delete |
| `brandId` | `String?` FK | one of brandId or competitorId is set |
| `competitorId` | `String?` FK | |
| `rankPosition` | `Int?` | appearance order in response |
| `sentiment` | `Sentiment?` | enum |
| `mentionContext` | `Text?` | 150-char context window |
| `mentionType` | `MentionType?` | enum — Gemini classified |
| `characterIndex` | `Int?` | char offset of first occurrence |
| `isInList` | `Boolean?` | true if inside a list response |
| `createdAt` | `DateTime` | |
| **Index** | `aiResponseId`, `brandId`, `competitorId` | |

#### `ConversionEvent`
| Field | Type | Notes |
|-------|------|-------|
| `id` | `String` UUID PK | |
| `brandId` | `String` | |
| `scanId` | `String?` | optional scan link |
| `utmSource/Medium/Campaign` | `String?` | UTM parameters |
| `sessionId` | `String?` | |
| `eventType` | `String` | |
| `pipelineValue` | `Float?` | |
| `occurredAt` | `DateTime` | |

### Enums

| Enum | Values |
|------|--------|
| `ScanStatus` | `PENDING` · `PROCESSING` · `COMPLETED` · `FAILED` |
| `Sentiment` | `POSITIVE` · `NEUTRAL` · `NEGATIVE` |
| `ResponseStructure` | `PARAGRAPH` · `LIST` · `TABLE` · `MIXED` |
| `MentionType` | `DIRECT_RECOMMENDATION` · `CASUAL_MENTION` · `COMPARISON` |
| `QueryIntent` | `INFORMATIONAL` · `NAVIGATIONAL` · `COMMERCIAL` · `TRANSACTIONAL` |

---

## 7. Service Layer Reference

### `aiService.js`

| Function | Model Used | Description |
|----------|------------|-------------|
| `getAiResponse(queryText, model)` | `gemini-2.5-flash` | Single query → AI response text |
| `generateQueries(brandName, industry, competitors, category, targetUser)` | `gemini-2.5-flash` | 3-phase prompt → 50 query JSON array |
| `validateQueries(queries, industry, category)` | `gemini-2.0-flash` | Quality gate → `{ valid, irrelevantQueries, reason }` |
| `getBatchAiResponses(queries[], model)` | `gemini-2.5-flash` | 10 queries per call → `[{ queryId, queryText, response }]` |
| `tryParseResponse(rawText)` | — | 3-strategy JSON parser (direct → sanitize → regex) |

---

### `queryService.js`

| Function | Description |
|----------|-------------|
| `autoPopulateQueries(brandId, industry, category, targetUser, scanId?)` | End-to-end: generate → validate → dedup → batch insert |

**Validation failure behaviour:** If `valid = false` AND a `scanId` is provided, the linked scan is immediately marked `FAILED` with a `failureReason` before throwing.

---

### `scanService.js`

| Function | Description |
|----------|-------------|
| `runScan(brandId)` | Full scan lifecycle: create scan → batch AI calls → detect → persist → score → close |
| `chunkArray(arr, size)` | Utility: splits array into fixed-size chunks |

**Batch size:** `BATCH_SIZE = 10` — 50 queries → 5 Gemini API calls.

---

### `detectionService.js`

| Function | Type | Description |
|----------|------|-------------|
| `runDetection(responseText, brand, competitors)` | async | Main orchestrator — returns `{ mentions, responseStructure }` |
| `detectResponseStructure(responseText)` | sync | Regex-based structure classifier |
| `extractMentionContext(responseText, entityName)` | sync | 150-char context window extractor |
| `classifyMentionType(contextWindow)` | async | Gemini 2.0-flash → `{ type, confidence }` |

---

### `scoringService.js`

| Function | Description |
|----------|-------------|
| `calculateVisibilityScore(scannedResponses, brandId, competitors)` | Returns full score object |
| `calcRawQueryScore(brandMention, allMentions)` | Per-response score 0–100 |
| `getMentionMultiplier(mention, allMentions)` | Multiplier based on mention type |

---

## 8. Scoring Algorithm

### Per-Query Score (`calcRawQueryScore`)

```
base = 50  (presence bonus)

rank bonuses:
  + 50 if rank = 1
  + 30 if rank = 2
  + 10 if rank ≥ 3

penalty:
  - 10 × (number of competitors ranked above brand)
  minimum: 0

multiply by mention multiplier (getMentionMultiplier):
```

### Mention Multiplier (`getMentionMultiplier`)

| Mention Type | Condition | Multiplier |
|---|---|:---:|
| `DIRECT_RECOMMENDATION` | — | **1.0×** |
| `COMPARISON` | Brand ranked above all competitors | **1.2×** |
| `COMPARISON` | Brand NOT ranked above all competitors | **0×** |
| `CASUAL_MENTION` | — | **0.5×** |
| *(no mention type)* | `POSITIVE` sentiment | **1.0×** |
| *(no mention type)* | `NEUTRAL` sentiment | **0.5×** |
| *(no mention type)* | `NEGATIVE` sentiment | **0×** |

### Final Brand Score

```
brandScore (0–100) = (sum of all query scores / (total queries × 100)) × 100
```

### Output Shape

```json
{
  "brandScore": 72.5,
  "competitorScores": { "<competitorId>": 55.0 },
  "brandAvgRank": 1.4,
  "competitorAvgRanks": { "<competitorId>": 2.1 },
  "queryScores": { "<aiResponseId>": 100 },
  "intentBreakdown": {
    "INFORMATIONAL": { "avgScore": 80.0, "queryCount": 12 },
    "COMMERCIAL": { "avgScore": 65.0, "queryCount": 8 }
  }
}
```

---

## 9. Environment & Infrastructure

### Environment Variables (`.env`)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key (falls back to mock mode if absent) |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Server port (default: `3000`) |

### Docker Compose

`docker-compose.yml` spins up a local PostgreSQL container for development:
- Database: `ai_visibility`
- Prisma connects via `DATABASE_URL`

### Database Driver

Prisma uses the **`@prisma/adapter-pg`** driver (connection pool via `pg.Pool`) instead of the default direct Prisma connection — enabling edge-compatible and pooled database access.

### Mock Mode

If `GEMINI_API_KEY` is not set, all AI service functions return hardcoded mock data so the server can run and be tested end-to-end without an API key.

---

*Generated by examining the full Agent 0 source on 2026-03-12.*
