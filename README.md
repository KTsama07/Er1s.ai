# ER1S.AI

The **ER1S.AI** is an **AI Engine Optimisation (AEO)** MVP. It is a backend and web application that automates the process of querying AI models (like Google Gemini) to determine how visible a specific brand is compared to its competitors across high-intent, industry-specific prompts.

---

## 🛠 Tech Stack

- **Backend Runtime:** Node.js
- **Web Framework:** Express.js
- **Database:** PostgreSQL (via Prisma ORM & `@prisma/adapter-pg`)
- **Queue/Workers:** Redis (Bull)
- **AI Integration:** Google Gemini API (`@google/genai`)
- **Frontend:** Vanilla HTML/CSS/JS (Glassmorphism styling)
- **Deployment:** Docker / Google Cloud Run

---

## 🏗 High-Level Design (HLD)

The following diagram illustrates the **Workflow, Data Flow, and Control Flow** of the system:

```mermaid
graph TD
    %% Core Entities
    Client[Browser / Dashboard]
    Web[Express.js Web Server]
    Worker[Background Queue Worker]
    
    %% Services
    ScanSvc[Scan Orchestration Service]
    QuerySvc[Query Generation Service]
    AiSvc[AI Integration Service]
    DetectSvc[Mention Detection Service]
    ScoreSvc[Scoring Algorithm Service]

    %% Data Stores
    DB[(PostgreSQL Database)]
    Redis[(Redis Queue)]
    Gemini[Google Gemini API]

    %% WORKFLOW & CONTROL FLOW
    Client -->|1. Setup Brand| Web
    Client -->|2. Generate Queries| Web
    Client -->|3. Run Full Scan| Web
    
    Web -->|Queue background job| Redis
    Redis -.->|Consume Job| Worker
    Worker -->|Execute| ScanSvc

    %% DATA FLOW
    Web -->|Route /queries/generate| QuerySvc
    QuerySvc -->|Generate 50 intents| AiSvc
    AiSvc <-->|Prompt| Gemini
    QuerySvc -->|Persist| DB

    ScanSvc -->|Fetch active queries| DB
    ScanSvc -->|Batch (10 queries/call)| AiSvc
    AiSvc <-->|Fetch raw AI responses| Gemini
    
    AiSvc -->|Raw text responses| DetectSvc
    DetectSvc -->|Analyze structure & entities| Gemini
    DetectSvc -->|Extract Mentions| ScoreSvc
    
    ScoreSvc -->|Calculate Visibility 0-100| ScanSvc
    
    %% Persistence
    ScanSvc -->|Save Scans, Mentions, Scores| DB
    
    Client -->|4. View Analytics| Web
    Web -->|Fetch Time-Series Data| DB
```

### Core Pipelines
1. **Query Generation:** The system uses a multi-phase AI prompt to research the brand's industry and generate 50 high-intent SEO queries *without* explicitly mentioning the brand name.
2. **Scan Orchestration:** The background worker pulls the 50 queries, chunks them into batches of 10, and runs them through the Gemini 2.5-flash model. 
3. **Detection & Scoring:** The raw AI responses are parsed to detect competitor and brand mentions. A secondary model (Gemini 2.0-flash) classifies the sentiment and mention type (e.g., Direct Recommendation vs. Comparison). A final score from 0-100 is calculated based on rank position and context.

---

## 🚀 How to Run the Project Locally

### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18+)
- [Docker & Docker Compose](https://www.docker.com/) (For PostgreSQL and Redis)
- Google Gemini API Key

### 1. Environment Setup
Create a `.env` file in the root directory and add the following variables:
```env
# Database and Redis Connections
DATABASE_URL="postgresql://postgres:password@localhost:5432/ai_visibility?schema=public"
REDIS_URL="redis://localhost:6379"

# AI Keys
GEMINI_API_KEY="your_google_gemini_api_key_here"
OPENAI_API_KEY="your_openai_api_key_here" # Optional, if using OpenAI fallbacks

# Application Port
PORT=3000
```

### 2. Start the Database and Redis
Use Docker Compose to spin up the local PostgreSQL database and Redis instance:
```bash
docker-compose up -d
```

### 3. Install Dependencies and Migrate DB
Install the Node modules and push the database schema using Prisma:
```bash
npm install
npx prisma generate
npx prisma migrate dev
```

### 4. Run the Application
The application is split into two processes for production, but locally you can run the web server and worker in separate terminal windows:

**Terminal 1 (Web Server):**
```bash
npm start
```

**Terminal 2 (Background Worker):**
```bash
npm run worker
```

Once running, navigate to `http://localhost:3000` in your browser to access the AEO Dashboard.

---

## ☁️ Deployment (Docker / Google Cloud Run)

This project includes a `Dockerfile` optimized for serverless container environments like Google Cloud Run.

1. **Build the container:**
   ```bash
   docker build -t ai-visibility-tracker .
   ```

2. **Run as Web Server:**
   ```bash
   docker run -p 3000:3000 --env-file .env ai-visibility-tracker npm start
   ```

3. **Run as Background Worker:**
   ```bash
   docker run --env-file .env ai-visibility-tracker npm run worker
   ```

*Note: When deploying to Cloud Run, ensure you provision a Serverless VPC Access connector to allow the container to communicate with your managed Cloud SQL and Memorystore (Redis) instances.*
