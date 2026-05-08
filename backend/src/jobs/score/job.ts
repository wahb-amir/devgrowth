// =============================================================
// score-dev-v3.job.ts — DB adapter for the V3 scorer
// Drop-in replacement for score-dev.job.ts
// =============================================================

import { RawSnapshotModel }    from "../../db/models/raw-snapshot.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { DeveloperModel }      from "../../db/models/developer.model.js";
import { jobQueue, type JobHandler } from "../queue.js";
import { scoreV3, SCORER_VERSION }   from "../../scorer/scorer.js";
import type { NormalizedProfile, HistoricalEntry } from "../../scorer/types.js";

// ── Shape DB documents into V3 input types ────────────────────

function toNormalizedProfile(rawDoc: any): NormalizedProfile {
  return {
    followers:    rawDoc.profile?.followers     ?? 0,
    repos:        rawDoc.profile?.public_repos  ?? 0,
    stars:        rawDoc.repoStats?.totalStars  ?? 0,
    forks:        rawDoc.repoStats?.totalForks  ?? 0,
    activity_30d: {
      pushes:   rawDoc.activity_30d?.pushes   ?? 0,
      prs:      rawDoc.activity_30d?.prs      ?? 0,
      issues:   rawDoc.activity_30d?.issues   ?? 0,
      releases: rawDoc.activity_30d?.releases ?? 0,
    },
    weeklyActivity: rawDoc.weeklyActivity ?? [],
  };
}

// ── Job handler ───────────────────────────────────────────────

export const scoreDevV3: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload ?? {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalized = username.trim().toLowerCase();

  // 1. Resolve developer
  const developer = await DeveloperModel.findOne({
    username: normalized,
  }).lean();
  if (!developer?._id) throw new Error("developer_not_found");

  // 2. Latest raw snapshot
  const rawDoc = await RawSnapshotModel.findOne({
    developerId: developer._id,
  })
    .sort({ takenAt: -1 })
    .lean();
  if (!rawDoc) throw new Error("snapshot_not_found");

  // 3. Historical scored snapshots for trend + confidence
  const historyDocs = await ScoredSnapshotModel.find({
    developerId: developer._id,
    scorerVersion: SCORER_VERSION, // only compare within V3 scores
  })
    .sort({ takenAt: 1 }) // oldest first for EMA calculation
    .limit(20)
    .lean();

  const history: HistoricalEntry[] = historyDocs.map((d) => ({
    takenAt:    d.takenAt ?? d.createdAt ?? new Date(),
    totalScore: typeof d.totalScore === "number" ? d.totalScore : 0,
  }));

  // 4. Score
  const profile = toNormalizedProfile(rawDoc);
  const result  = scoreV3({
    profile,
    history,
    snapshotCount: historyDocs.length + 1,
  });

  // 5. Persist
  const previousSnapshotId = historyDocs.at(-1)?._id;

  const saved = await ScoredSnapshotModel.create({
    developerId:   developer._id,
    rawSnapshotId: rawDoc._id,
    takenAt:       new Date(),
    scorerVersion: SCORER_VERSION,

    totalScore:    result.finalScore,
    percentileRank: null, // populated by a separate percentile job
    devType:       result.archetype,
    growthScore:   result.trend,

    normalizedProfile: {
      followers:   profile.followers,
      repos:       profile.repos,
      stars:       profile.stars,
      forks:       profile.forks,
      activity_30d: profile.activity_30d,
    },

    subScores: {
      activity: {
        score:         result.subScores.activity,
        weight:        0.30,
        weightedScore: result.subScores.activity * 0.30,
        signals:       [],
        tags:          ["activity", result.archetype],
      },
      impact: {
        score:         result.subScores.impact,
        weight:        0.35,
        weightedScore: result.subScores.impact * 0.35,
        signals:       [],
        tags:          ["impact"],
      },
      consistency: {
        score:         result.subScores.consistency,
        weight:        0.20,
        weightedScore: result.subScores.consistency * 0.20,
        signals:       [],
        tags:          ["consistency"],
      },
      reach: {
        score:         result.subScores.reach,
        weight:        0.15,
        weightedScore: result.subScores.reach * 0.15,
        signals:       [],
        tags:          ["reach"],
      },
    },
  });

  // 6. Update developer record
  await DeveloperModel.updateOne(
    { _id: developer._id },
    { $set: { lastFetchedAt: new Date(), ingestionStatus: "completed" } }
  );

  // 7. Enqueue insight generation
  jobQueue.enqueue(
    {
      name: "generate:insights",
      payload: {
        developerId:             String(developer._id),
        scoredSnapshotId:        String(saved._id),
        previousScoredSnapshotId: previousSnapshotId
          ? String(previousSnapshotId)
          : undefined,
      },
    },
    1
  );

  return {
    success:   true,
    username:  normalized,
    durationMs: Date.now() - start,
    metadata: {
      developerId:      String(developer._id),
      scoredSnapshotId: String(saved._id),
      scorerVersion:    SCORER_VERSION,
      archetype:        result.archetype,
      confidence:       result.confidence,
      trendLabel:       result.trendLabel,
      warnings:         result.meta.warnings,
      scores: {
        final:       result.finalScore,
        activity:    result.subScores.activity,
        impact:      result.subScores.impact,
        consistency: result.subScores.consistency,
        reach:       result.subScores.reach,
      },
    },
  };
};