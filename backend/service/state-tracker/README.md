# State Tracker Service

Central execution ledger for distributed developer intelligence pipelines.

> "Everything that happens is an event. Every job is a timeline. Every state is derivable."

## What it does

Records execution truth for all pipelines (GitHub ingestor, Portfolio ingestor, etc). It does **not** analyze, score, or decide — it only tracks.

## Tech Stack

- Node.js + TypeScript
- Fastify
- PostgreSQL + Prisma

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# 3. Generate Prisma client & run migrations
npm run prisma:generate
npm run prisma:migrate

# 4. Start dev server
npm run dev
```

## API Reference

### Create Job
```
POST /jobs
{ "job_id": "uuid", "developer_id": "123", "source": "github" }
→ 201 { job }
```

### Start Job
```
POST /jobs/:jobId/start
→ 200 { job }
```

### Start Step
```
POST /jobs/:jobId/step/start
{ "step": "fetch_profile" }
→ 200 { job, step }
```

### Complete Step
```
POST /jobs/:jobId/step/complete
{ "step": "fetch_profile", "payload": {} }
→ 200 { job, step }
```

### Fail Step
```
POST /jobs/:jobId/step/fail
{ "step": "normalize_profile", "error": "rate limit exceeded" }
→ 200 { job, step }
```

### Get Job State
```
GET /jobs/:jobId?includeEvents=true&eventsLimit=50&eventsOffset=0
→ 200 { job_id, status, steps[], events[], eventsMeta }
```

### Health Check
```
GET /health
→ 200 { status: "ok" }
```

## Design Principles

| Rule | Behavior |
|------|----------|
| Append-only events | `job_events` rows are never updated or deleted |
| Mutable snapshot | `jobs` table status/current_step can be updated |
| Idempotency | Duplicate step events create a new attempt row, not an error |
| Non-blocking | Event append failures are caught and logged — never thrown |
| No service awareness | Zero knowledge of GitHub/Portfolio/Orchestrator logic |

## Folder Structure

```
src/
├── app.ts              # Fastify app factory
├── server.ts           # Entry point + graceful shutdown
├── config/db.ts        # Prisma singleton
├── modules/
│   ├── jobs/           # Job CRUD + orchestration of steps/events
│   ├── steps/          # Step lifecycle tracking
│   └── events/         # Append-only event log
├── shared/
│   ├── enums.ts        # JobStatus, StepStatus, EventType
│   ├── errors.ts       # Typed error classes
│   └── utils.ts        # Helpers
└── middleware/
    └── errorHandler.ts # Global Fastify error handler
```
