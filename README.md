# 🚀 DevGrowth

**DevGrowth** is a developer growth intelligence platform that helps developers understand their progress over time, identify strengths and weaknesses, and improve through actionable feedback — not just rankings.

Unlike traditional leaderboard tools, DevGrowth focuses on **long-term growth, insights, and developer evolution**, not one-time scores.

---

## 🧠 Core Idea

Most developer ranking systems answer:

> “Where do I rank?”

DevGrowth answers:

> “How am I improving as a developer, and what should I do next?”

It tracks:

- Activity over time
- Contribution quality
- Consistency
- External impact
- Growth trends

---

## ⚙️ Tech Stack

Frontend:

- Next.js (Vercel deployment)
- Tailwind CSS
- Recharts (data visualization)

Backend:

- Fastify (Node.js)
- Modular monolith architecture
- Background job system (cron-based)

Database:

- MongoDB (Atlas)

External API:

- GitHub API

---

## 🏗️ System Architecture

GitHub API
↓
Backend (Fastify)
↓
Discovery → Enrichment → Scoring → Insights
↓
MongoDB (Profiles + Snapshots)
↓
Next.js Frontend
↓
Dashboard + Profile + Progress Tracking

---

## 📦 Project Structure

```
devgrowth/
├── backend
│   ├── packages
│   │   └── discovery-sdk
│   │       ├── package.json
│   │       ├── pnpm-lock.yaml
│   │       ├── src
│   │       │   ├── client
│   │       │   │   ├── github.client.ts
│   │       │   │   ├── http.ts
│   │       │   │   ├── portfolio.client.ts
│   │       │   │   └── stateTracker.client.ts
│   │       │   ├── config.ts
│   │       │   ├── index.ts
│   │       │   ├── services
│   │       │   │   ├── github.ts
│   │       │   │   ├── job.ts
│   │       │   │   └── portfolio.ts
│   │       │   ├── types
│   │       │   │   └── index.ts
│   │       │   └── validators
│   │       │       └── github.ts
│   │       └── tsconfig.json
│   └── service
│       ├── github-ingestor
│       │   ├── package.json
│       │   ├── pnpm-lock.yaml
│       │   ├── pnpm-workspace.yaml
│       │   ├── src
│       │   │   ├── db
│       │   │   │   ├── connection.ts
│       │   │   │   └── models
│       │   │   │       ├── developer.model.ts
│       │   │   │       ├── index.ts
│       │   │   │       ├── insight.model.ts
│       │   │   │       ├── raw-snapshot.model.ts
│       │   │   │       └── scored-snapshot.model.ts
│       │   │   ├── hooks
│       │   │   │   └── auth.ts
│       │   │   ├── insights
│       │   │   │   ├── archetypes.ts
│       │   │   │   ├── dedup.ts
│       │   │   │   ├── engine.ts
│       │   │   │   └── score-band.ts
│       │   │   ├── jobs
│       │   │   │   ├── discover
│       │   │   │   │   └── job.ts
│       │   │   │   ├── ingest
│       │   │   │   │   └── job.ts
│       │   │   │   ├── insights
│       │   │   │   │   └── job.ts
│       │   │   │   ├── queue.ts
│       │   │   │   ├── scheduler.ts
│       │   │   │   ├── score
│       │   │   │   │   └── job.ts
│       │   │   │   ├── TrackedEnqueue.ts
│       │   │   │   └── types.ts
│       │   │   ├── lib
│       │   │   │   ├── config.ts
│       │   │   │   ├── github-client.ts
│       │   │   │   └── github-service.ts
│       │   │   ├── main.ts
│       │   │   ├── routes
│       │   │   │   ├── developers.ts
│       │   │   │   └── health.ts
│       │   │   ├── scorer
│       │   │   │   ├── layers.ts
│       │   │   │   ├── math.ts
│       │   │   │   ├── narrative.ts
│       │   │   │   ├── scorer.ts
│       │   │   │   ├── Scorerv3full.test.ts
│       │   │   │   └── types.ts
│       │   │   └── server.ts
│       │   └── tsconfig.json
│       ├── orchestrator
│       ├── portfolio-ingestor
│       │   ├── package.json
│       │   ├── pnpm-lock.yaml
│       │   ├── pnpm-workspace.yaml
│       │   ├── src
│       │   │   ├── db
│       │   │   │   ├── connection.ts
│       │   │   │   └── models
│       │   │   │       └── portfolio.model.ts
│       │   │   ├── jobs
│       │   │   │   ├── discover
│       │   │   │   │   └── job.ts
│       │   │   │   ├── ingest
│       │   │   │   │   └── job.ts
│       │   │   │   ├── portfolio
│       │   │   │   │   ├── cleaner.ts
│       │   │   │   │   ├── collect.job.ts
│       │   │   │   │   ├── crawler.ts
│       │   │   │   │   ├── enricher.ts
│       │   │   │   │   ├── extractor.ts
│       │   │   │   │   ├── fetcher.ts
│       │   │   │   │   ├── merger.ts
│       │   │   │   │   ├── parser.ts
│       │   │   │   │   ├── rendered.job.ts
│       │   │   │   │   ├── security.ts
│       │   │   │   │   ├── skills-dictionary.ts
│       │   │   │   │   ├── store.job.ts
│       │   │   │   │   └── types.ts
│       │   │   │   ├── queue.ts
│       │   │   │   └── TrackedEnqueue.ts
│       │   │   ├── lib
│       │   │   │   ├── config.ts
│       │   │   │   └── normalizeSource.ts
│       │   │   ├── main.ts
│       │   │   ├── routes
│       │   │   │   ├── health.ts
│       │   │   │   └── portfolio.ts
│       │   │   └── server.ts
│       │   └── tsconfig.json
│       └── state-tracker
│           ├── package.json
│           ├── package-lock.json
│           ├── pnpm-lock.yaml
│           ├── pnpm-workspace.yaml
│           ├── prisma
|           | 
│           ├── README.md
│           ├── src
│           │   ├── app.ts
│           │   ├── config
│           │   │   └── db.ts
│           │   ├── middleware
│           │   │   └── errorHandler.ts
│           │   ├── modules
│           │   │   ├── events
│           │   │   │   ├── events.repository.ts
│           │   │   │   ├── events.service.ts
│           │   │   │   └── events.types.ts
│           │   │   ├── jobs
│           │   │   │   ├── jobs.controller.ts
│           │   │   │   ├── jobs.repository.ts
│           │   │   │   ├── jobs.service.ts
│           │   │   │   └── jobs.types.ts
│           │   │   └── steps
│           │   │       ├── steps.repository.ts
│           │   │       ├── steps.service.ts
│           │   │       └── steps.types.ts
│           │   ├── server.ts
│           │   ├── shared
│           │   │   ├── enums.ts
│           │   │   ├── errors.ts
│           │   │   └── utils.ts
│           │   └── types
│           │       └── global.d.ts
│           └── tsconfig.json
├── LICENSE
└── README.md
```

## 🔄 How It Works

1. Discovery (GitHub API)
2. Data Fetching (profile, repos, events)
3. Normalization (convert raw data → signals)
4. Scoring Engine (multi-dimensional scoring)
5. Insight Engine (feedback + explanations)
6. History Tracking (snapshots over time)

---

## 📊 Core Features (MVP)

- GitHub-based developer profiles
- Modular scoring system
- Developer dashboard
- Profile breakdown view
- Basic leaderboard (secondary feature)
- Score explanation system
- Growth tracking via snapshots

---

## 🧠 Key Principles

- Not a static leaderboard
- Not a vanity ranking tool
- Growth-focused system
- Transparent scoring
- Actionable insights
- Long-term engagement

---

## 🚀 Deployment

Frontend (Vercel):
NEXT_PUBLIC_API_URL=<backend-url>

Backend (HF Space):

- Fastify server
- Docker deployment

Database:

- MongoDB Atlas

---

## 🧪 API Endpoints (MVP)

GET /api/dev/:username
GET /api/dev/:username/snapshot
GET /api/leaderboard
POST /api/ingest/:username

---

## 📈 Future Roadmap

Phase 1:

- GitHub ingestion
- basic scoring
- developer profiles

Phase 2:

- insights engine
- history tracking

Phase 3:

- weekly reports
- growth charts

Phase 4:

- multi-source enrichment
- collaboration graph

---

## ⚠️ Vision

DevGrowth is not about ranking developers.

It is about helping developers become better over time.
