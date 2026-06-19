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
    Client([🌐 Browser / Dashboard]):::clientStyle
    Web([⚡ Express.js Web Server]):::serverStyle

    %% Queue
    Redis[(🗄 Redis Queue)]:::queueStyle
    Worker([⚙️ Background Worker]):::queueStyle

    %% Services
    QuerySvc([📝 Query Generation Service]):::serviceStyle
    ScanSvc([🔍 Scan Orchestration Service]):::serviceStyle
    AiSvc([🤖 AI Integration Service]):::aiStyle
    DetectSvc([🔎 Mention Detection Service]):::aiStyle
    ScoreSvc([📊 Scoring Algorithm Service]):::aiStyle

    %% Data Stores
    DB[(🗃 PostgreSQL Database)]:::dbStyle
    Gemini([✨ Google Gemini API]):::geminiStyle

    %% --- CONTROL FLOW green ---
    Client -->|1 Setup Brand| Web
    Client -->|2 Generate Queries| Web
    Client -->|3 Run Full Scan| Web
    Web -->|Queue Job| Redis
    Redis -->|Consume Job| Worker
    Worker -->|Execute| ScanSvc

    %% --- DATA FLOW blue ---
    Web -->|Route to Query Service| QuerySvc
    QuerySvc -->|50 Queries Generated| AiSvc
    AiSvc -->|Prompt| Gemini
    Gemini -->|Raw AI Responses| AiSvc
    AiSvc -->|Batch Responses| DetectSvc
    DetectSvc -->|Classify Mentions| Gemini
    DetectSvc -->|Extracted Mentions| ScoreSvc
    ScoreSvc -->|Visibility Score 0-100| ScanSvc
    ScanSvc -->|Fetch Queries| DB
    ScanSvc -->|Save Results| DB
    QuerySvc -->|Persist Queries| DB
    Client -->|4 View Analytics| Web
    Web -->|Fetch Time-Series Data| DB

    %% --- STYLES ---
    classDef clientStyle  fill:#DBEAFE,stroke:#3B82F6,color:#1E3A5F,font-weight:bold
    classDef serverStyle  fill:#FEF3C7,stroke:#F59E0B,color:#78350F,font-weight:bold
    classDef queueStyle   fill:#EDE9FE,stroke:#7C3AED,color:#3B0764,font-weight:bold
    classDef serviceStyle fill:#DCFCE7,stroke:#16A34A,color:#14532D,font-weight:bold
    classDef aiStyle      fill:#FEF9C3,stroke:#CA8A04,color:#713F12,font-weight:bold
    classDef dbStyle      fill:#FFE4E6,stroke:#E11D48,color:#881337,font-weight:bold
    classDef geminiStyle  fill:#CCFBF1,stroke:#0D9488,color:#134E4A,font-weight:bold

    linkStyle 0,1,2,3,4,5 stroke:#16A34A,stroke-width:2px
    linkStyle 6,7,8,9,10,11,12,13,14,15,16,17,18 stroke:#2563EB,stroke-width:2px
```

> 🟢 **Green arrows** = Control Flow (commands and triggers)  
> 🔵 **Blue arrows** = Data Flow (data moving between services)

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
