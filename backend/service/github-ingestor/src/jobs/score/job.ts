// =============================================================
// score-dev-v3full.job.ts — DB adapter for the V3 Full scorer
// Drop-in replacement for score-dev-v3.job.ts
//
// Changes vs the old adapter:
//   • Drives scoreV3Full() not scoreV3()
//   • Builds EnrichedSnapshot (not NormalizedProfile)
//   • Maps commitSignals + prSignals + per-repo breadth from raw doc
//   • Persists quality subscore (new 5th dimension)
//   • Persists narrative, confidenceInterval, confidenceLevel
//   • Passes subScores into history so tension detection works
//   • scorerVersion filter on history query scoped to v3.1.x
// =============================================================

import { RawSnapshotModel }    from "../../db/models/raw-snapshot.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { DeveloperModel }      from "../../db/models/developer.model.js";
import { jobQueue, type JobHandler } from "../queue.js";
import { scoreV3Full,SCORER_VERSION } from "../../scorer/scorer.js";

import type {
  EnrichedSnapshot,
  HistoricalScore,
  RepoSignal,
  CommitSignals,
  PRSignals,
} from "../../scorer/types.js";

// =============================================================
// Raw-doc → EnrichedSnapshot mapping
// =============================================================

/**
 * Builds per-repo RepoSignal array from the raw snapshot document.
 *
 * The raw doc may contain a `repos` array (enriched pipeline) or
 * fall back to a single synthetic repo built from aggregate stats.
 * The fallback is safe — L1 breadth scoring degrades gracefully
 * when only one repo entry is present.
 */
function toRepoSignals(rawDoc: any): RepoSignal[] {
  // Enriched pipeline provides per-repo breakdown
  if (Array.isArray(rawDoc.repos) && rawDoc.repos.length > 0) {
    return rawDoc.repos.map((r: any): RepoSignal => ({
      repoId:          String(r.repoId   ?? r._id ?? "unknown"),
      stars:           r.stars           ?? 0,
      forks:           r.forks           ?? 0,
      dependents:      r.dependents      ?? 0,
      pkgComplexity:   r.pkgComplexity   ?? 0,
      isActive:        r.isActive        ?? false,
      primaryLanguage: r.primaryLanguage ?? "unknown",
      pushCount:       r.pushCount       ?? 0,
    }));
  }

  // Fallback: synthesize one entry from aggregate repoStats.
  // singleRepoConcentration will NOT fire (pushCount/total = 1/1 = 100%
  // only when totalRepos === 1, which is true for this fallback).
  // The breadth score will be neutral — acceptable degradation.
  return [{
    repoId:          "aggregate-fallback",
    stars:           rawDoc.repoStats?.totalStars  ?? 0,
    forks:           rawDoc.repoStats?.totalForks  ?? 0,
    dependents:      0,
    pkgComplexity:   0,
    isActive:        true,
    primaryLanguage: rawDoc.profile?.primaryLanguage ?? "unknown",
    pushCount:       rawDoc.activity_30d?.pushes    ?? 0,
  }];
}

/**
 * Maps commit-level signals if the enriched pipeline populated them.
 * Returns undefined if absent — L1 degrades gracefully with defaults.
 */
function toCommitSignals(rawDoc: any): CommitSignals | undefined {
  const cs = rawDoc.commitSignals;
  if (!cs) return undefined;
  return {
    totalCommits:    cs.totalCommits    ?? 0,
    avgLinesChanged: cs.avgLinesChanged ?? 0,
    refactorRatio:   cs.refactorRatio   ?? 0,
    testFileRatio:   cs.testFileRatio   ?? 0,
  };
}

/**
 * Maps PR-level signals if the enriched pipeline populated them.
 * Returns undefined if absent — L1 degrades gracefully with defaults.
 */
function toPRSignals(rawDoc: any): PRSignals | undefined {
  const pr = rawDoc.prSignals;
  if (!pr) return undefined;
  return {
    opened:              pr.opened              ?? 0,
    merged:              pr.merged              ?? 0,
    reviewed:            pr.reviewed            ?? 0,
    avgTimeToMergeHours: pr.avgTimeToMergeHours ?? 0,
  };
}

/**
 * Full raw-doc → EnrichedSnapshot conversion.
 *
 * accountCreatedAt falls back to "1 year ago" when the raw doc
 * does not carry the profile creation date. This is conservative:
 * the age-normalization factor at 365 days is neutral, whereas
 * 0 days would divide by zero and max-age would over-penalize.
 */
function toEnrichedSnapshot(rawDoc: any): EnrichedSnapshot {
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);

  return {
    takenAt: rawDoc.takenAt ?? new Date(),

    profile: {
      followers:        rawDoc.profile?.followers      ?? 0,
      public_repos:     rawDoc.profile?.public_repos   ?? 0,
      accountCreatedAt: rawDoc.profile?.accountCreatedAt
        ? new Date(rawDoc.profile.accountCreatedAt)
        : oneYearAgo,
      primaryLanguage:  rawDoc.profile?.primaryLanguage ?? undefined,
    },

    repoStats: {
      totalStars: rawDoc.repoStats?.totalStars ?? 0,
      totalForks: rawDoc.repoStats?.totalForks ?? 0,
      totalRepos: rawDoc.repoStats?.totalRepos ?? 0,
      repos:      toRepoSignals(rawDoc),
    },

    activity_30d: {
      pushes:   rawDoc.activity_30d?.pushes   ?? 0,
      prs:      rawDoc.activity_30d?.prs      ?? 0,
      issues:   rawDoc.activity_30d?.issues   ?? 0,
      releases: rawDoc.activity_30d?.releases ?? 0,
    },

    weeklyActivity: Array.isArray(rawDoc.weeklyActivity)
      ? rawDoc.weeklyActivity.map((w: any) => ({
          weekOffset: w.weekOffset ?? 0,
          pushes:     w.pushes     ?? 0,
          prs:        w.prs        ?? 0,
          issues:     w.issues     ?? 0,
          releases:   w.releases   ?? 0,
        }))
      : [],

    commitSignals: toCommitSignals(rawDoc),
    prSignals:     toPRSignals(rawDoc),
  };
}

/**
 * Maps a scored snapshot DB document → HistoricalScore.
 * Carries subScores so the tension engine can compare current
 * vs previous quality/activity divergence patterns.
 */
function toHistoricalScore(doc: any): HistoricalScore {
  return {
    takenAt:    doc.takenAt ?? doc.createdAt ?? new Date(),
    totalScore: typeof doc.totalScore === "number" ? doc.totalScore : 0,
    subScores:  doc.subScores
      ? {
          activity:    doc.subScores.activity?.score    ?? 0,
          impact:      doc.subScores.impact?.score      ?? 0,
          quality:     doc.subScores.quality?.score     ?? 0,
          consistency: doc.subScores.consistency?.score ?? 0,
          reach:       doc.subScores.reach?.score       ?? 0,
        }
      : undefined,
  };
}

// =============================================================
// Job handler
// =============================================================

export const scoreDevV3Full: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload ?? {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalized = username.trim().toLowerCase();

  // ── 1. Resolve developer ────────────────────────────────────
  const developer = await DeveloperModel.findOne({
    username: normalized,
  }).lean();
  if (!developer?._id) throw new Error("developer_not_found");

  // ── 2. Latest raw snapshot ──────────────────────────────────
  const rawDoc = await RawSnapshotModel.findOne({
    developerId: developer._id,
  })
    .sort({ takenAt: -1 })
    .lean();
  if (!rawDoc) throw new Error("snapshot_not_found");

  // ── 3. History (V3.1.x scores only, oldest first) ──────────
  //
  // Scoping to SCORER_VERSION prefix ("v3.1") prevents mixing
  // scores computed by different calibrations — a v3.0.0 score
  // at position 50 and a v3.1.0 score at 70 would produce a
  // false-negative velocity reading.
  const historyDocs = await ScoredSnapshotModel.find({
    developerId:   developer._id,
    scorerVersion: { $regex: /^v3\.1/ },
  })
    .sort({ takenAt: 1 })   // oldest first — EMA requires chronological order
    .limit(20)
    .lean();

  const history: HistoricalScore[] = historyDocs.map(toHistoricalScore);
  const snapshotCount = historyDocs.length + 1;

  // ── 4. Score ────────────────────────────────────────────────
  const snapshot = toEnrichedSnapshot(rawDoc);

  const result = scoreV3Full({
    snapshot,
    history,
    snapshotCount,
    // cohortPeers: injected by a separate percentile-ranking job
    // after the scored snapshot is written to the collection.
  });

  // ── 5. Persist scored snapshot ──────────────────────────────
  const previousDoc = historyDocs.at(-1);

  const saved = await ScoredSnapshotModel.create({
    developerId:   developer._id,
    rawSnapshotId: rawDoc._id,
    takenAt:       new Date(),
    scorerVersion: SCORER_VERSION,   // "v3.1.0"

    totalScore:         result.finalScore,
    percentileRank:     result.percentileRank,   // null until percentile job runs
    devType:            result.archetype,
    growthScore:        result.trend,

    // Confidence envelope — new fields vs old schema
    confidence:         result.confidence,
    confidenceLevel:    result.confidenceLevel,
    confidenceInterval: result.confidenceInterval,

    momentum:           result.momentum,

    normalizedProfile: {
      followers:    snapshot.profile.followers,
      repos:        snapshot.profile.public_repos,
      stars:        snapshot.repoStats.totalStars,
      forks:        snapshot.repoStats.totalForks,
      activity_30d: snapshot.activity_30d,
    },

    // 5 sub-scores (quality is new vs v2/v3.0 schema)
    subScores: {
      activity: {
        score:         result.subScores.activity,
        weight:        result.layers.l5.weights.activity,
        weightedScore: result.subScores.activity * result.layers.l5.weights.activity,
        signals:       [],
        tags:          ["activity", result.archetype],
      },
      impact: {
        score:         result.subScores.impact,
        weight:        result.layers.l5.weights.impact,
        weightedScore: result.subScores.impact * result.layers.l5.weights.impact,
        signals:       [],
        tags:          ["impact"],
      },
      quality: {
        score:         result.subScores.quality,
        weight:        result.layers.l5.weights.quality,
        weightedScore: result.subScores.quality * result.layers.l5.weights.quality,
        signals:       [],
        tags:          ["quality", "pr_merge_rate", "review_participation"],
      },
      consistency: {
        score:         result.subScores.consistency,
        weight:        result.layers.l5.weights.consistency,
        weightedScore: result.subScores.consistency * result.layers.l5.weights.consistency,
        signals:       [],
        tags:          ["consistency"],
      },
      reach: {
        score:         result.subScores.reach,
        weight:        result.layers.l5.weights.reach,
        weightedScore: result.subScores.reach * result.layers.l5.weights.reach,
        signals:       [],
        tags:          ["reach"],
      },
    },

    // Anti-exploit audit trail
    antiExploit: result.antiExploit,

    // Narrative — stored for the insight rendering layer to consume
    // without re-running the scorer
    narrative: {
      headline:             result.narrative.headline,
      tension:              result.narrative.tension,
      tensionDescription:   result.narrative.tensionDescription,
      strengths:            result.narrative.strengths,
      watchAreas:           result.narrative.watchAreas,
      trajectoryStatement:  result.narrative.trajectoryStatement,
      confidenceStatement:  result.narrative.confidenceStatement,
    },
  });

  // ── 6. Update developer record ──────────────────────────────
  await DeveloperModel.updateOne(
    { _id: developer._id },
    {
      $set: {
        lastFetchedAt:    new Date(),
        ingestionStatus:  "completed",
      },
    }
  );

  // ── 7. Enqueue downstream jobs ──────────────────────────────
  //
  // generate:insights reads the persisted narrative directly —
  // no re-scoring needed.
  jobQueue.enqueue(
    {
      name: "generate:insights",
      payload: {
        developerId:              String(developer._id),
        scoredSnapshotId:         String(saved._id),
        previousScoredSnapshotId: previousDoc?._id
          ? String(previousDoc._id)
          : undefined,
      },
    },
    1   // high priority
  );

  // ── 8. Return job result ────────────────────────────────────
  return {
    success:    true,
    username:   normalized,
    durationMs: Date.now() - start,
    metadata: {
      developerId:        String(developer._id),
      scoredSnapshotId:   String(saved._id),
      scorerVersion:      SCORER_VERSION,
      archetype:          result.archetype,
      momentum:           result.momentum,
      confidenceLevel:    result.confidenceLevel,
      confidenceInterval: result.confidenceInterval,
      warnings:           result.meta.warnings,
      dataQuality:        result.layers.l0.dataQualityScore,
      scores: {
        final:       result.finalScore,
        activity:    result.subScores.activity,
        impact:      result.subScores.impact,
        quality:     result.subScores.quality,
        consistency: result.subScores.consistency,
        reach:       result.subScores.reach,
      },
      antiExploit: result.antiExploit,
    },
  };
};