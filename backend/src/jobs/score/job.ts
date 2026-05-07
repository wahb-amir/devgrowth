// ============================================================
// score-dev.job.ts — Job adapter (v2)
//
// Bridges the existing MongoDB pipeline to the new 7-layer
// scorer. Minimal changes to the job contract; all scoring
// logic lives in scorer.ts and layers.ts.
// ============================================================

import { RawSnapshotModel } from "../../db/models/raw-snapshot.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { DeveloperModel } from "../../db/models/developer.model.js";
import { jobQueue, type JobHandler } from "../queue.js";
import { scoreSnapshot, SCORER_VERSION } from "../../scorer/scorer.js";
import type { RawSnapshot, HistoricalScore } from "../../scorer/types.js";

// ─────────────────────────────────────────────────────────────
// Helpers: shape DB documents into scorer input types
// ─────────────────────────────────────────────────────────────

function toRawSnapshot(doc: any): RawSnapshot {
  return {
    takenAt: doc.takenAt ?? new Date(),
    profile: {
      followers: doc.profile?.followers ?? 0,
      public_repos: doc.profile?.public_repos ?? 0,
    },
    repoStats: {
      totalStars: doc.repoStats?.totalStars ?? 0,
      totalForks: doc.repoStats?.totalForks ?? 0,
      totalRepos: doc.repoStats?.totalRepos ?? 0,
    },
    activity_30d: {
      pushes: doc.activity_30d?.pushes ?? 0,
      prs: doc.activity_30d?.prs ?? 0,
      issues: doc.activity_30d?.issues ?? 0,
      releases: doc.activity_30d?.releases ?? 0,
    },
    // weeklyActivity is optional — scorer handles its absence gracefully
    weeklyActivity: doc.weeklyActivity ?? [],
  };
}

function toHistoricalScore(doc: any): HistoricalScore {
  return {
    takenAt: doc.takenAt ?? doc.createdAt ?? new Date(),
    totalScore: typeof doc.totalScore === "number" ? doc.totalScore : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Job handler
// ─────────────────────────────────────────────────────────────
export const scoreDev: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload ?? {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalized = username.trim().toLowerCase();

  // ── 1. Resolve developer ──────────────────────────────────
  const developer = await DeveloperModel.findOne({ username: normalized }).lean();
  if (!developer?._id) throw new Error("developer_not_found");

  // ── 2. Latest raw snapshot ────────────────────────────────
  const rawDoc = await RawSnapshotModel.findOne({ developerId: developer._id })
    .sort({ takenAt: -1 })
    .lean();
  if (!rawDoc) throw new Error("snapshot_not_found");

  // ── 3. Historical scored snapshots (for L6 + L7) ─────────
  const historyDocs = await ScoredSnapshotModel.find({
    developerId: developer._id,
  })
    .sort({ takenAt: -1 })
    .limit(20) // last 20 is sufficient for EMA / slope
    .lean();

  // ── 4. Run 7-layer scorer ─────────────────────────────────
  const snapshot = toRawSnapshot(rawDoc);
  const history: HistoricalScore[] = historyDocs.map(toHistoricalScore);

  // Cohort injection: pass an empty array for now.
  // Replace with a real cohort query (e.g. from a Redis cache
  // or a pre-computed collection) once the data pipeline is ready.
  const cohort: { totalScore: number; repoCount: number }[] = [];

  const result = scoreSnapshot(snapshot, {
    cohort,
    history,
    decayHalfLifeDays: 10,
  });

  // ── 5. Persist scored snapshot ────────────────────────────
  const previousSnapshotId = historyDocs[0]?._id;

  const savedSnapshot = await ScoredSnapshotModel.create({
    developerId: developer._id,
    rawSnapshotId: rawDoc._id,
    takenAt: new Date(),
    scorerVersion: SCORER_VERSION,

    totalScore: result.finalScore,
    percentileRank: result.percentileRank,
    devType: result.archetype,
    growthScore: result.growthScore,

    normalizedProfile: {
      followers: snapshot.profile.followers,
      repos: snapshot.profile.public_repos,
      stars: snapshot.repoStats.totalStars,
      forks: snapshot.repoStats.totalForks,
      activity_30d: snapshot.activity_30d,
    },

    subScores: {
      activity: {
        score: result.layers.l5.compositeScore, // surfaced from L5
        weight: result.layers.l5.weights.activity,
        weightedScore:
          result.layers.l5.compositeScore * result.layers.l5.weights.activity,
        signals: [],
        tags: ["activity", result.archetype],
      },
      impact: {
        score: result.layers.l1.stars * 100,
        weight: result.layers.l5.weights.impact,
        weightedScore: result.layers.l1.stars * 100 * result.layers.l5.weights.impact,
        signals: [],
        tags: ["impact"],
      },
      consistency: {
        score: result.layers.l2.consistencyVariance * 100,
        weight: result.layers.l5.weights.consistency,
        weightedScore:
          result.layers.l2.consistencyVariance *
          100 *
          result.layers.l5.weights.consistency,
        signals: [],
        tags: ["consistency"],
      },
      reach: {
        score: result.layers.l1.followers * 100,
        weight: result.layers.l5.weights.reach,
        weightedScore:
          result.layers.l1.followers * 100 * result.layers.l5.weights.reach,
        signals: [],
        tags: ["reach"],
      },
    },
  });

  // ── 6. Update developer document ──────────────────────────
  await DeveloperModel.updateOne(
    { _id: developer._id },
    {
      $set: {
        lastFetchedAt: new Date(),
        ingestionStatus: "completed",
      },
    }
  );

  // ── 7. Enqueue downstream insight generation ──────────────
  jobQueue.enqueue(
    {
      name: "generate:insights",
      payload: {
        developerId: String(developer._id),
        scoredSnapshotId: String(savedSnapshot._id),
        previousScoredSnapshotId: previousSnapshotId
          ? String(previousSnapshotId)
          : undefined,
      },
    },
    1
  );

  return {
    success: true,
    username: normalized,
    durationMs: Date.now() - start,
    metadata: {
      developerId: String(developer._id),
      scoredSnapshotId: String(savedSnapshot._id),
      scorerVersion: SCORER_VERSION,
      archetype: result.archetype,
      momentum: result.momentum,
      confidence: result.confidence,
      warnings: result.meta.warnings,
      latestScores: {
        totalScore: result.finalScore,
        rawCompositeScore: result.rawCompositeScore,
        devType: result.archetype,
        growthScore: result.growthScore,
        percentileRank: result.percentileRank,
      },
    },
  };
};