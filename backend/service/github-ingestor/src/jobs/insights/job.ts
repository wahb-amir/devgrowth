// src/jobs/generate-insights.job.ts

import type { Job, JobResult } from "../queue.js";
import { DeveloperModel } from "../../db/models/developer.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { InsightModel } from "../../db/models/insight.model.js";
import { runNarrativeEngine } from "../../insights/engine.js";

const INSIGHT_VERSION = "2.1.0";
const RECENT_DAYS = 14;
const PREVIOUS_DAYS = 14;

type GenerateInsightsPayload = {
  developerId: string;
  scoredSnapshotId: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function safeTrend(current: number, previous: number) {
  return clamp((current - previous) / 100, -1, 1);
}

// ─── Core ──────────────────────────────────────────────────────────────────────

async function generateInsightsCore(input: GenerateInsightsPayload) {
  const { developerId, scoredSnapshotId } = input;

  const [developer, latestSnapshot] = await Promise.all([
    DeveloperModel.findById(developerId).lean(),
    ScoredSnapshotModel.findOne({ _id: scoredSnapshotId, developerId }).lean(),
  ]);

  if (!developer) throw new Error("Developer not found");
  if (!latestSnapshot)
    throw new Error("Scored snapshot not found for developer");

  const anchorDate = new Date(latestSnapshot.takenAt);
  const recentStart = new Date(
    anchorDate.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000,
  );
  const previousStart = new Date(
    anchorDate.getTime() - (RECENT_DAYS + PREVIOUS_DAYS) * 24 * 60 * 60 * 1000,
  );

  const snapshots = await ScoredSnapshotModel.find({
    developerId,
    takenAt: { $gte: previousStart, $lte: anchorDate },
  })
    .sort({ takenAt: 1 })
    .lean();

  const recentSnaps = snapshots.filter(
    (s) => new Date(s.takenAt) >= recentStart,
  );
  const previousSnaps = snapshots.filter(
    (s) => new Date(s.takenAt) < recentStart,
  );

  // Current sub-scores come from the anchor snapshot; trend is relative to
  // the previous window average so a single snapshot doesn't create fake swings
  const cur = latestSnapshot.subScores;
  const currentActivity = cur?.activity?.score ?? 0;
  const currentImpact = cur?.impact?.score ?? 0;
  const currentConsistency = cur?.consistency?.score ?? 0;
  const currentReach = cur?.reach?.score ?? 0;

  const prevActivity = avg(
    previousSnaps.map((s) => s.subScores?.activity?.score ?? 0),
  );
  const prevImpact = avg(
    previousSnaps.map((s) => s.subScores?.impact?.score ?? 0),
  );
  const prevConsistency = avg(
    previousSnaps.map((s) => s.subScores?.consistency?.score ?? 0),
  );
  const prevReach = avg(
    previousSnaps.map((s) => s.subScores?.reach?.score ?? 0),
  );

  const activityTrend = safeTrend(currentActivity, prevActivity);
  const impactTrend = safeTrend(currentImpact, prevImpact);
  const consistencyTrend = safeTrend(currentConsistency, prevConsistency);
  const reachTrend = safeTrend(currentReach, prevReach);

  const overallTrendScore =
    activityTrend * 0.35 +
    impactTrend * 0.35 +
    consistencyTrend * 0.2 +
    reachTrend * 0.1;

  const profile = latestSnapshot.normalizedProfile;

  const narrative = runNarrativeEngine({
    username: developer.username,
    activityScore: currentActivity,
    impactScore: currentImpact,
    consistencyScore: currentConsistency,
    reachScore: currentReach,
    totalScore: latestSnapshot.totalScore,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    overallTrendScore,
    repos: profile?.repos ?? 0,
    stars: profile?.stars ?? 0,
    followers: profile?.followers ?? 0,
    pushes: profile?.activity_30d?.pushes ?? 0,
    prs: profile?.activity_30d?.prs ?? 0,
    issues: profile?.activity_30d?.issues ?? 0,
    releases: profile?.activity_30d?.releases ?? 0,
    recentSnapshotCount: recentSnaps.length,
    previousSnapshotCount: previousSnaps.length,
  });

  const growthRate = Number(Math.max(0, overallTrendScore).toFixed(4));

  await InsightModel.findOneAndUpdate(
    { developerId, scoredSnapshotId },
    {
      $set: {
        generatedAt: new Date(),
        insightVersion: INSIGHT_VERSION,
        devType: narrative.archetype,
        scoreBand: narrative.scoreBand, // new field
        trendLabel: narrative.trendLabel,
        growthRate,
        keySignals: narrative.keySignals,
        warnings: narrative.warnings,
        cards: narrative.cards,
      },
    },
    { upsert: true },
  );

  return {
    cardCount: narrative.cards.length,
    devType: narrative.archetype,
    scoreBand: narrative.scoreBand,
    trend: narrative.trendLabel,
    growthRate,
    keySignals: narrative.keySignals,
    warnings: narrative.warnings,
    username: developer.username,
  };
}

// ─── Job handler ───────────────────────────────────────────────────────────────

export async function generateInsightsJob(job: Job): Promise<JobResult> {
  const startedAt = Date.now();

  try {
    if (job.name !== "generate:insights") {
      return {
        success: false,
        durationMs: Date.now() - startedAt,
        error: `Invalid job name: ${job.name}`,
        retryable: false,
        statusCode: 400,
      };
    }

    const payload = job.payload as GenerateInsightsPayload | undefined;

    if (!payload?.developerId || !payload?.scoredSnapshotId) {
      return {
        success: false,
        durationMs: Date.now() - startedAt,
        error: "Missing developerId or scoredSnapshotId",
        retryable: false,
        statusCode: 400,
      };
    }

    const result = await generateInsightsCore(payload);

    return {
      success: true,
      durationMs: Date.now() - startedAt,
      action: "generate:insights",
      username: result.username,
    };
  } catch (err) {
    return {
      success: false,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
      statusCode: 500,
      action: "generate:insights",
    };
  }
}
