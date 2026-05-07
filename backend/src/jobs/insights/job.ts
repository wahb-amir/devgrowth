// src/jobs/generate-insights.job.ts

import type { Job, JobResult } from "../queue.js";
import { DeveloperModel } from "../../db/models/developer.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { InsightModel } from "../../db/models/insight.model.js";

const INSIGHT_VERSION = "1.0.0";
const RECENT_DAYS = 14;
const PREVIOUS_DAYS = 14;

type DevType =
  | "builder"
  | "impact_dev"
  | "maintainer"
  | "rising_dev"
  | "balanced"
  | "watch_area";

type TrendLabel = "improving" | "stable" | "declining";

type WindowMetrics = {
  count: number;
  avgTotalScore: number;
  avgActivityScore: number;
  avgImpactScore: number;
  avgConsistencyScore: number;
  avgReachScore: number;
  avgRawActivity: number;
};

type GenerateInsightsPayload = {
  developerId: string;
  scoredSnapshotId: string;
  previousScoredSnapshotId?: string;
};

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

function activityVolume(activity: {
  pushes?: number;
  prs?: number;
  issues?: number;
  releases?: number;
}) {
  return (
    (activity?.pushes ?? 0) +
    (activity?.prs ?? 0) +
    (activity?.issues ?? 0) +
    (activity?.releases ?? 0)
  );
}

function getWindowMetrics(snapshots: any[]): WindowMetrics {
  if (!snapshots.length) {
    return {
      count: 0,
      avgTotalScore: 0,
      avgActivityScore: 0,
      avgImpactScore: 0,
      avgConsistencyScore: 0,
      avgReachScore: 0,
      avgRawActivity: 0,
    };
  }

  return {
    count: snapshots.length,
    avgTotalScore: avg(snapshots.map((s) => s.totalScore ?? 0)),
    avgActivityScore: avg(
      snapshots.map((s) => s.subScores?.activity?.score ?? 0),
    ),
    avgImpactScore: avg(snapshots.map((s) => s.subScores?.impact?.score ?? 0)),
    avgConsistencyScore: avg(
      snapshots.map((s) => s.subScores?.consistency?.score ?? 0),
    ),
    avgReachScore: avg(snapshots.map((s) => s.subScores?.reach?.score ?? 0)),
    avgRawActivity: avg(
      snapshots.map((s) => activityVolume(s.normalizedProfile?.activity_30d)),
    ),
  };
}

function classifyDevType(args: {
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  recent: WindowMetrics;
}): DevType {
  const { activityTrend, impactTrend, consistencyTrend, reachTrend, recent } =
    args;

  const improvingScore =
    (activityTrend + impactTrend + consistencyTrend + reachTrend) / 4;

  if (
    activityTrend > 0.08 &&
    impactTrend <= 0.02 &&
    recent.avgActivityScore >= 55
  ) {
    return "builder";
  }

  if (
    impactTrend > 0.08 &&
    activityTrend <= 0.04 &&
    recent.avgImpactScore >= 55
  ) {
    return "impact_dev";
  }

  if (
    recent.avgConsistencyScore >= 60 &&
    Math.abs(consistencyTrend) <= 0.04 &&
    recent.count >= 3
  ) {
    return "maintainer";
  }

  if (improvingScore >= 0.08 && recent.count >= 2) {
    return "rising_dev";
  }

  if (
    recent.avgActivityScore < 45 &&
    recent.avgImpactScore < 45 &&
    recent.avgConsistencyScore < 45
  ) {
    return "watch_area";
  }

  return "balanced";
}

function trendLabelFromScore(score: number): TrendLabel {
  if (score >= 0.06) return "improving";
  if (score <= -0.06) return "declining";
  return "stable";
}

function devTypeTitle(type: DevType) {
  switch (type) {
    case "builder":
      return "Fast-growing builder with strong consistency";
    case "impact_dev":
      return "High-impact contributor with selective activity";
    case "maintainer":
      return "Steady maintainer with reliable consistency";
    case "rising_dev":
      return "Rising developer with improving signal quality";
    case "watch_area":
      return "Profile needs attention";
    default:
      return "Balanced developer profile";
  }
}

function buildSummaryBody(args: {
  username: string;
  devType: DevType;
  trendLabel: TrendLabel;
}) {
  const { username, devType, trendLabel } = args;

  const baseByType: Record<DevType, string> = {
    builder:
      "Activity is rising faster than impact, which usually means the developer is shipping a lot and building momentum.",
    impact_dev:
      "Impact is growing faster than activity, which suggests more meaningful contributions with less noise.",
    maintainer:
      "Consistency is the main strength here. The profile looks stable and dependable.",
    rising_dev:
      "Multiple signals are moving in the right direction, which makes this profile worth watching closely.",
    balanced:
      "The profile is broadly balanced with no extreme weakness or breakout signal yet.",
    watch_area:
      "The profile is currently weak across the main signals and needs more sustained progress.",
  };

  const trendLine =
    trendLabel === "improving"
      ? "The overall direction is improving."
      : trendLabel === "declining"
        ? "The overall direction is slipping."
        : "The overall direction is mostly stable.";

  return `${username} looks like a ${devType.replace("_", " ")}. ${baseByType[devType]} ${trendLine}`;
}

function buildKeySignals(args: {
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  recent: WindowMetrics;
}) {
  const { activityTrend, impactTrend, consistencyTrend, reachTrend, recent } =
    args;

  const signals: string[] = [];

  if (activityTrend > 0.08)
    signals.push("Activity increased over the recent window");
  else if (activityTrend < -0.08)
    signals.push("Activity dropped in the recent window");

  if (impactTrend > 0.08) signals.push("Impact improved noticeably");
  else if (impactTrend < -0.08) signals.push("Impact is weakening");

  if (consistencyTrend > 0.06) signals.push("Consistency improved");
  else if (consistencyTrend < -0.06) signals.push("Consistency is slipping");

  if (reachTrend > 0.06) signals.push("Reach is expanding");

  if (!signals.length && recent.count > 0) {
    signals.push("Signal mix is currently stable");
  }

  return signals.slice(0, 3);
}

function buildWarnings(args: {
  recent: WindowMetrics;
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
}) {
  const { recent, activityTrend, impactTrend, consistencyTrend, reachTrend } =
    args;

  const warnings: string[] = [];

  if (activityTrend > 0.08 && impactTrend <= 0.02) {
    warnings.push("High activity but impact is still lagging");
  }

  if (consistencyTrend < -0.06) {
    warnings.push("Consistency is becoming more erratic");
  }

  if (impactTrend < -0.08 && recent.avgActivityScore >= 50) {
    warnings.push("Work volume is not translating into meaningful impact");
  }

  if (reachTrend < -0.06 && recent.avgReachScore < 45) {
    warnings.push("Reach has not expanded yet");
  }

  if (!warnings.length && recent.count >= 2 && activityTrend <= 0.02) {
    warnings.push("No strong momentum signal yet");
  }

  return warnings.slice(0, 3);
}

function cardTypeForScoreAndTrend(score: number, trend: number) {
  if (trend >= 0.08 && score >= 55) return "strength" as const;
  if (trend <= -0.08 && score <= 55) return "watch_area" as const;
  if (trend >= 0.08) return "opportunity" as const;
  if (trend <= -0.08) return "watch_area" as const;
  if (score >= 70) return "strength" as const;
  return "neutral" as const;
}

function buildInsightCards(args: {
  scoredSnapshotId: string;
  username: string;
  devType: DevType;
  trendLabel: TrendLabel;
  recent: WindowMetrics;
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  keySignals: string[];
  warnings: string[];
}) {
  const {
    scoredSnapshotId,
    username,
    devType,
    trendLabel,
    recent,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    keySignals,
    warnings,
  } = args;

  const overallType =
    trendLabel === "improving"
      ? "milestone"
      : trendLabel === "declining"
        ? "watch_area"
        : "neutral";

  const overallCard = {
    scoredSnapshotId,
    generatedAt: new Date(),
    insightVersion: INSIGHT_VERSION,
    type: overallType,
    category: "overall",
    title: devTypeTitle(devType),
    body: buildSummaryBody({
      username,
      devType,
      trendLabel,
    }),
    relatedSubScore: "overall",
    triggerTags: [
      `devType:${devType}`,
      `trend:${trendLabel}`,
      ...keySignals
        .slice(0, 2)
        .map((s) => s.toLowerCase().replace(/\s+/g, "_")),
    ],
    priority: 100,
  };

  const cards = [
    overallCard,
    {
      scoredSnapshotId,
      generatedAt: new Date(),
      insightVersion: INSIGHT_VERSION,
      type: cardTypeForScoreAndTrend(recent.avgActivityScore, activityTrend),
      category: "activity",
      title: "Activity trend",
      body:
        activityTrend > 0.08
          ? "Activity is rising steadily across the recent window."
          : activityTrend < -0.08
            ? "Activity has fallen compared to the previous window."
            : "Activity is mostly stable right now.",
      relatedSubScore: "activity",
      triggerTags: [
        "activity",
        activityTrend > 0 ? "trend_up" : "trend_flat_or_down",
      ],
      priority: 80,
    },
    {
      scoredSnapshotId,
      generatedAt: new Date(),
      insightVersion: INSIGHT_VERSION,
      type: cardTypeForScoreAndTrend(recent.avgImpactScore, impactTrend),
      category: "impact",
      title: "Impact trend",
      body:
        impactTrend > 0.08
          ? "Impact improved, which means contributions are becoming more meaningful."
          : impactTrend < -0.08
            ? "Impact is slipping relative to the prior window."
            : "Impact is stable for now.",
      relatedSubScore: "impact",
      triggerTags: [
        "impact",
        impactTrend > 0 ? "trend_up" : "trend_flat_or_down",
      ],
      priority: 70,
    },
    {
      scoredSnapshotId,
      generatedAt: new Date(),
      insightVersion: INSIGHT_VERSION,
      type: cardTypeForScoreAndTrend(
        recent.avgConsistencyScore,
        consistencyTrend,
      ),
      category: "consistency",
      title: "Consistency trend",
      body:
        consistencyTrend > 0.06
          ? "Consistency improved, which is a strong sign of repeatable output."
          : consistencyTrend < -0.06
            ? "Consistency is getting noisier."
            : "Consistency is holding steady.",
      relatedSubScore: "consistency",
      triggerTags: [
        "consistency",
        consistencyTrend > 0 ? "trend_up" : "trend_flat_or_down",
      ],
      priority: 75,
    },
    {
      scoredSnapshotId,
      generatedAt: new Date(),
      insightVersion: INSIGHT_VERSION,
      type: cardTypeForScoreAndTrend(recent.avgReachScore, reachTrend),
      category: "reach",
      title: "Reach trend",
      body:
        reachTrend > 0.06
          ? "Reach is expanding, so this profile is becoming more visible."
          : reachTrend < -0.06
            ? "Reach has weakened compared to the previous window."
            : "Reach is stable.",
      relatedSubScore: "reach",
      triggerTags: [
        "reach",
        reachTrend > 0 ? "trend_up" : "trend_flat_or_down",
      ],
      priority: 65,
    },
  ];

  for (const warning of warnings) {
    cards.push({
      scoredSnapshotId,
      generatedAt: new Date(),
      insightVersion: INSIGHT_VERSION,
      type: "watch_area" as const,
      category: "overall" as const,
      title: "Watch area",
      body: warning,
      relatedSubScore: "overall" as const,
      triggerTags: ["warning"],
      priority: 50,
    });
  }

  return cards;
}

async function generateInsightsCore(input: GenerateInsightsPayload) {
  const { developerId, scoredSnapshotId } = input;

  const developer = await DeveloperModel.findById(developerId).lean();
  if (!developer) {
    throw new Error("Developer not found");
  }

  const latestSnapshot = await ScoredSnapshotModel.findOne({
    _id: scoredSnapshotId,
    developerId,
  }).lean();

  if (!latestSnapshot) {
    throw new Error("Scored snapshot not found for developer");
  }

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

  const recentSnapshots = snapshots.filter(
    (s) => new Date(s.takenAt) >= recentStart,
  );
  const previousSnapshots = snapshots.filter(
    (s) => new Date(s.takenAt) < recentStart,
  );

  const recent = getWindowMetrics(recentSnapshots);
  const previous = getWindowMetrics(previousSnapshots);

  const activityTrend = safeTrend(
    recent.avgActivityScore,
    previous.avgActivityScore,
  );
  const impactTrend = safeTrend(recent.avgImpactScore, previous.avgImpactScore);
  const consistencyTrend = safeTrend(
    recent.avgConsistencyScore,
    previous.avgConsistencyScore,
  );
  const reachTrend = safeTrend(recent.avgReachScore, previous.avgReachScore);

  const overallTrendScore =
    activityTrend * 0.35 +
    impactTrend * 0.35 +
    consistencyTrend * 0.2 +
    reachTrend * 0.1;

  const trendLabel = trendLabelFromScore(overallTrendScore);
  const devType = classifyDevType({
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    recent,
  });

  const keySignals = buildKeySignals({
    recent,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
  });

  const warnings = buildWarnings({
    recent,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
  });

  await InsightModel.deleteMany({
    developerId,
    scoredSnapshotId,
  });

  const cards = buildInsightCards({
    scoredSnapshotId,
    username: developer.username,
    devType,
    trendLabel,
    recent,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    keySignals,
    warnings,
  }).map((card) => ({
    ...card,
    developerId,
  }));

  await InsightModel.bulkWrite(
    cards.map((c) => ({
      updateOne: {
        filter: {
          developerId: c.developerId,
          scoredSnapshotId: c.scoredSnapshotId,
          category: c.category,
        },
        update: { $set: c },
        upsert: true,
      },
    })),
  );

  return {
    inserted: cards.length,
    devType,
    trend: trendLabel,
    growthRate: Number(Math.max(0, overallTrendScore).toFixed(4)),
    keySignals,
    warnings,
    username: developer.username,
  };
}

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
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      durationMs: Date.now() - startedAt,
      error: message,
      retryable: true,
      statusCode: 500,
      action: "generate:insights",
    };
  }
}
