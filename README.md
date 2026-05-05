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

devgrowth/
│
├── frontend/               # Next.js app (Vercel)
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── hooks/
│
├── backend/               # Fastify API (HF Space)
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── jobs/
│   │   ├── models/
│   │   ├── utils/
│   │   └── db/
│
├── shared/
└── README.md

---

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

GET  /api/dev/:username
GET  /api/dev/:username/snapshot
GET  /api/leaderboard
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