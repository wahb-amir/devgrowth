// src/insights/engine.ts

/**
 * Developer Narrative Intelligence Engine
 *
 * Produces 3–6 high-signal cards as a coherent structured analysis.
 * All logic is deterministic and rule-based.
 *
 * Card order: headline → strengths → tensions → trajectory → confidence → watch_areas
 */

import { InsightCard } from "../db/models/insight.model.js";
import { classifyArchetype } from "./archetypes.js";
import type { Archetype } from "./archetypes.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export type EngineInput = {
  username: string;
  // Current snapshot sub-scores
  activityScore: number;
  impactScore: number;
  consistencyScore: number;
  reachScore: number;
  totalScore: number;
  // Trend direction per dimension (clamped -1..1, /100 scale)
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  overallTrendScore: number;
  // Activity shape from normalizedProfile
  repos: number;
  stars: number;
  followers: number;
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
  // Window sizes used for confidence
  recentSnapshotCount: number;
  previousSnapshotCount: number;
};

export type NarrativeResult = {
  archetype: Archetype;
  archetypeTitle: string;
  trendLabel: "improving" | "stable" | "declining";
  cards: InsightCard[];
  keySignals: string[];
  warnings: string[];
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

type TrendLabel = "improving" | "stable" | "declining";

function trendLabel(score: number): TrendLabel {
  if (score >= 0.06) return "improving";
  if (score <= -0.06) return "declining";
  return "stable";
}

function collaborationRatio(
  pushes: number,
  prs: number,
  issues: number
): number {
  const total = pushes + prs + issues;
  if (total === 0) return 0;
  return ((prs + issues) / total) * 100;
}

function totalActivity(
  pushes: number,
  prs: number,
  issues: number,
  releases: number
): number {
  return pushes + prs + issues + releases;
}

/** Confidence tier based on how many snapshots we have to work with. */
function confidenceTier(
  recentCount: number,
  previousCount: number
): "high" | "medium" | "low" {
  const total = recentCount + previousCount;
  if (total >= 6 && recentCount >= 3) return "high";
  if (total >= 3) return "medium";
  return "low";
}

// ─── Tension detection ─────────────────────────────────────────────────────────

type Tension = {
  key: string;
  body: string;
  severity: "high" | "medium";
};

function detectTensions(input: EngineInput): Tension[] {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    pushes,
    prs,
    issues,
    repos,
    stars,
    activityTrend,
    impactTrend,
    reachTrend,
  } = input;

  const tensions: Tension[] = [];
  const collab = collaborationRatio(pushes, prs, issues);

  // Activity vs impact gap — the most common meaningful tension
  if (activityScore >= 55 && impactScore < 35) {
    tensions.push({
      key: "activity_impact_gap",
      body:
        "High contribution volume is not translating into ecosystem impact. " +
        "This typically indicates work is concentrated in low-visibility or private repositories, " +
        "or that commit patterns are not yet generating engagement (stars, forks, dependents).",
      severity: "high",
    });
  } else if (activityScore >= 45 && impactScore < 30) {
    tensions.push({
      key: "activity_impact_gap_moderate",
      body:
        "Contribution activity outpaces ecosystem impact. " +
        "Visibility and downstream engagement have not yet scaled with commit volume.",
      severity: "medium",
    });
  }

  // Reach vs consistency gap
  if (reachScore < 30 && consistencyScore >= 55) {
    tensions.push({
      key: "consistency_reach_gap",
      body:
        "Contribution cadence is strong but ecosystem visibility remains limited. " +
        "Consistent work is occurring without proportional public recognition or follower growth.",
      severity: "medium",
    });
  }

  // Impact growing faster than activity — positive tension worth surfacing
  if (impactTrend > activityTrend + 0.08 && impactScore >= 40) {
    tensions.push({
      key: "impact_outpacing_activity",
      body:
        "Impact is growing faster than activity volume, suggesting recent contributions " +
        "are landing in higher-visibility repositories or generating stronger downstream engagement.",
      severity: "medium",
    });
  }

  // High reach, weak consistency
  if (reachScore >= 50 && consistencyScore < 35) {
    tensions.push({
      key: "reach_consistency_gap",
      body:
        "Strong ecosystem visibility is not matched by consistent contribution activity. " +
        "Recognition may be driven by legacy work rather than current momentum.",
      severity: "high",
    });
  }

  // Rising activity, stagnant or falling reach
  if (activityTrend > 0.08 && reachTrend < -0.04) {
    tensions.push({
      key: "rising_activity_falling_reach",
      body:
        "Activity is increasing while ecosystem reach is contracting. " +
        "New contributions are not expanding the public footprint.",
      severity: "medium",
    });
  }

  // Stars high relative to impact score (recognition not captured in score)
  if (stars >= 10 && impactScore < 40) {
    tensions.push({
      key: "stars_impact_mismatch",
      body:
        "Repository star count suggests prior high-visibility work, " +
        "but current impact signals are weak — indicating reduced activity in those repositories.",
      severity: "medium",
    });
  }

  // Very low collaboration for active developer
  if (collab < 5 && activityScore >= 50) {
    tensions.push({
      key: "low_collab_high_activity",
      body:
        "Contribution volume is solid, but almost entirely commit-driven with minimal " +
        "pull request or issue engagement. This limits collaborative visibility.",
      severity: "medium",
    });
  }

  // Impact trend falling despite relatively high impact score
  if (impactTrend < -0.08 && impactScore >= 50) {
    tensions.push({
      key: "impact_declining_from_strength",
      body:
        "Impact has been a relative strength but is showing a notable decline. " +
        "Recent contributions may be shifting toward lower-visibility areas.",
      severity: "high",
    });
  }

  // Return at most 2, prioritising high severity
  return tensions
    .sort((a, b) => (a.severity === "high" ? -1 : 1))
    .slice(0, 2);
}

// ─── Strength detection ────────────────────────────────────────────────────────

type Strength = {
  key: string;
  body: string;
  score: number; // used for prioritisation
};

function detectStrengths(input: EngineInput): Strength[] {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    repos,
    pushes,
    prs,
    issues,
    releases,
    stars,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
  } = input;

  const strengths: Strength[] = [];
  const collab = collaborationRatio(pushes, prs, issues);
  const vol = totalActivity(pushes, prs, issues, releases);

  if (activityScore >= 65) {
    strengths.push({
      key: "strong_activity",
      body:
        `Contribution velocity is a standout signal. ` +
        (vol > 100
          ? `With over ${vol} tracked events in the recent window, activity is well above typical developer cadence.`
          : `Consistent multi-vector activity across pushes, PRs, and issues demonstrates sustained engagement.`),
      score: activityScore,
    });
  }

  if (impactScore >= 60) {
    strengths.push({
      key: "strong_impact",
      body:
        `Ecosystem impact is a clear strength. ` +
        (stars >= 5
          ? `Repository star count and engagement signals indicate meaningful visibility within the ecosystem.`
          : `Contributions are generating above-average downstream engagement relative to activity volume.`),
      score: impactScore,
    });
  }

  if (consistencyScore >= 60) {
    strengths.push({
      key: "strong_consistency",
      body:
        "Contribution cadence is stable and repeatable. " +
        "The absence of significant gaps suggests a reliable development rhythm across the measured period.",
      score: consistencyScore,
    });
  }

  if (reachScore >= 55) {
    strengths.push({
      key: "strong_reach",
      body:
        "Ecosystem visibility is a notable strength. " +
        (repos >= 10
          ? `Active presence across ${repos} repositories contributes to a broad public footprint.`
          : "Follower growth and repository engagement indicate rising public recognition."),
      score: reachScore,
    });
  }

  // Trend-based strength: something accelerating significantly
  if (activityTrend > 0.12 && activityScore >= 45) {
    strengths.push({
      key: "accelerating_activity",
      body:
        "Activity growth rate is elevated relative to the prior period. " +
        "Contribution velocity is accelerating, not just holding steady.",
      score: activityScore + 10,
    });
  }

  if (impactTrend > 0.1 && impactScore >= 35) {
    strengths.push({
      key: "accelerating_impact",
      body:
        "Impact is improving at a faster rate than the underlying activity growth, " +
        "suggesting contributions are shifting toward higher-visibility areas.",
      score: impactScore + 10,
    });
  }

  if (collab > 30 && activityScore >= 45) {
    strengths.push({
      key: "high_collaboration",
      body:
        `Over ${Math.round(collab)}% of activity is collaborative in nature (PRs and issues), ` +
        "indicating strong engagement with other contributors and maintainers.",
      score: 60,
    });
  }

  // Return top 2 strengths by score
  return strengths.sort((a, b) => b.score - a.score).slice(0, 2);
}

// ─── Watch area detection ──────────────────────────────────────────────────────

type WatchArea = {
  key: string;
  body: string;
};

function detectWatchAreas(input: EngineInput): WatchArea[] {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    totalScore,
    pushes,
    prs,
    issues,
  } = input;

  const areas: WatchArea[] = [];
  const collab = collaborationRatio(pushes, prs, issues);

  if (totalScore < 30) {
    areas.push({
      key: "low_total_score",
      body:
        "Overall profile score is in the lower tier. " +
        "Sustained progress across activity, impact, and consistency will be needed before this profile signals meaningful ecosystem presence.",
    });
  }

  if (impactScore < 30 && activityScore >= 35) {
    areas.push({
      key: "weak_impact",
      body:
        "Impact remains the weakest signal relative to activity. " +
        "Contributing to repositories with broader audiences or improving repo discoverability " +
        "could help close this gap.",
    });
  }

  if (reachScore < 25) {
    areas.push({
      key: "weak_reach",
      body:
        "Ecosystem reach is limited. " +
        "Follower count, repository stars, and forks are all low — " +
        "the public footprint has not yet established itself.",
    });
  }

  if (consistencyTrend < -0.08) {
    areas.push({
      key: "declining_consistency",
      body:
        "Contribution regularity is deteriorating. " +
        "Gaps in cadence are widening compared to the prior period.",
    });
  }

  if (activityTrend < -0.08 && activityScore < 50) {
    areas.push({
      key: "declining_activity",
      body:
        "Activity is falling from an already moderate baseline. " +
        "Without a reversal, overall score momentum will stall.",
    });
  }

  if (collab < 5 && impactScore < 35) {
    areas.push({
      key: "no_collaboration_signal",
      body:
        "Minimal PR and issue activity means the profile generates almost no collaborative signal, " +
        "which limits both impact and reach scoring.",
    });
  }

  return areas.slice(0, 2);
}

// ─── Key signals and warnings for top-level fields ────────────────────────────

function deriveKeySignals(tensions: Tension[], strengths: Strength[]): string[] {
  const signals: string[] = [];
  for (const s of strengths) signals.push(s.body.split(".")[0]);
  for (const t of tensions.filter((t) => t.severity === "high"))
    signals.push(t.body.split(".")[0]);
  return signals.slice(0, 3);
}

function deriveWarnings(watchAreas: WatchArea[]): string[] {
  return watchAreas.map((w) => w.body.split(".")[0]).slice(0, 3);
}

// ─── Card construction ─────────────────────────────────────────────────────────

function makeCard(
  overrides: Partial<InsightCard> & Pick<InsightCard, "type" | "category" | "title" | "body" | "relatedSubScore" | "triggerTags" | "priority">
): InsightCard {
  return overrides as InsightCard;
}

function buildHeadlineCard(
  input: EngineInput,
  archetypeTitle: string,
  archetypeDescription: string,
  trend: TrendLabel
): InsightCard {
  const trendClause =
    trend === "improving"
      ? "Overall trajectory is positive."
      : trend === "declining"
      ? "Overall trajectory is declining."
      : "The profile is in a holding pattern with no strong directional shift.";

  return makeCard({
    type: trend === "improving" ? "milestone" : trend === "declining" ? "watch_area" : "neutral",
    category: "overall",
    title: archetypeTitle,
    body: `${archetypeDescription} ${trendClause}`,
    relatedSubScore: "overall",
    triggerTags: ["headline", `trend:${trend}`],
    priority: 100,
  });
}

function buildStrengthCard(strength: Strength): InsightCard {
  return makeCard({
    type: "strength",
    category: "overall",
    title: "Key strength",
    body: strength.body,
    relatedSubScore: "overall",
    triggerTags: ["strength", strength.key],
    priority: 85,
  });
}

function buildTensionCard(tension: Tension): InsightCard {
  return makeCard({
    type: tension.severity === "high" ? "watch_area" : "opportunity",
    category: "overall",
    title: "Signal tension",
    body: tension.body,
    relatedSubScore: "overall",
    triggerTags: ["tension", tension.key, `severity:${tension.severity}`],
    priority: tension.severity === "high" ? 90 : 75,
  });
}

function buildTrajectoryCard(input: EngineInput, trend: TrendLabel): InsightCard | null {
  const {
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    activityScore,
    impactScore,
    totalScore,
  } = input;

  // Only emit a trajectory card when there's something specific and non-obvious to say
  const leadingDimension =
    impactTrend > activityTrend && impactTrend > consistencyTrend
      ? "impact"
      : activityTrend > consistencyTrend
      ? "activity"
      : "consistency";

  const laggingDimension =
    reachTrend < impactTrend && reachTrend < activityTrend
      ? "reach"
      : impactScore < activityScore - 20
      ? "impact"
      : null;

  if (trend === "stable" && Math.abs(activityTrend) < 0.05 && Math.abs(impactTrend) < 0.05) {
    // Nothing interesting to say about a flat profile
    return null;
  }

  let body: string;

  if (trend === "improving") {
    body =
      laggingDimension
        ? `The primary growth driver is ${leadingDimension}, though ${laggingDimension} remains the lagging dimension. ` +
          `If the leading signal continues, overall score has headroom to grow — ` +
          `but closing the ${laggingDimension} gap will determine whether growth compounds or plateaus.`
        : `${leadingDimension.charAt(0).toUpperCase() + leadingDimension.slice(1)} is the primary driver of recent improvement. ` +
          `If this momentum holds, overall score trajectory points upward across the next measurement window.`;
  } else if (trend === "declining") {
    body =
      `Downward pressure is led by ${leadingDimension === "activity" ? "falling activity" : `a weakening ${leadingDimension} signal`}. ` +
      (totalScore > 40
        ? "The profile retains enough overall mass that a brief recovery could stabilize the trend."
        : "Given the current score level, a continued decline risks pushing the profile into a low-signal state.");
  } else {
    body =
      `Signals are mixed: ${leadingDimension} is trending positive while ${laggingDimension ?? "other dimensions"} ` +
      `show limited movement. Overall momentum is neutral, with no clear directional breakout yet.`;
  }

  return makeCard({
    type: "trajectory",
    category: "overall",
    title: "Trajectory analysis",
    body,
    relatedSubScore: "overall",
    triggerTags: ["trajectory", `trend:${trend}`, `leading:${leadingDimension}`],
    priority: 70,
  });
}

function buildConfidenceCard(
  input: EngineInput,
  tier: "high" | "medium" | "low"
): InsightCard | null {
  const { recentSnapshotCount, previousSnapshotCount, totalScore } = input;
  const total = recentSnapshotCount + previousSnapshotCount;

  // Only emit a confidence card when confidence is not high — no need to state the obvious
  if (tier === "high") return null;

  const body =
    tier === "low"
      ? `Analysis is based on limited historical data (${total} snapshot${total === 1 ? "" : "s"}). ` +
        "Claims about trajectory and trend direction should be treated as provisional. " +
        "Confidence will improve as more snapshots accumulate."
      : `Profile history covers a moderate window (${total} snapshots). ` +
        "Trend directional signals are reasonably reliable, but edge cases and score volatility " +
        "may not yet be fully captured.";

  return makeCard({
    type: "confidence",
    category: "overall",
    title: tier === "low" ? "Low confidence warning" : "Moderate confidence",
    body,
    relatedSubScore: "overall",
    triggerTags: ["confidence", `tier:${tier}`, `snapshots:${total}`],
    priority: 60,
  });
}

function buildWatchAreaCard(area: WatchArea): InsightCard {
  return makeCard({
    type: "watch_area",
    category: "overall",
    title: "Watch area",
    body: area.body,
    relatedSubScore: "overall",
    triggerTags: ["watch_area", area.key],
    priority: 55,
  });
}

// ─── Main engine entry point ───────────────────────────────────────────────────

export function runNarrativeEngine(input: EngineInput): NarrativeResult {
  const archetypeResult = classifyArchetype({
    activityScore: input.activityScore,
    impactScore: input.impactScore,
    consistencyScore: input.consistencyScore,
    reachScore: input.reachScore,
    repos: input.repos,
    stars: input.stars,
    followers: input.followers,
    pushes: input.pushes,
    prs: input.prs,
    issues: input.issues,
    activityTrend: input.activityTrend,
    impactTrend: input.impactTrend,
    consistencyTrend: input.consistencyTrend,
    reachTrend: input.reachTrend,
    totalScore: input.totalScore,
  });

  const overallTrend = trendLabel(input.overallTrendScore);
  const confidence = confidenceTier(
    input.recentSnapshotCount,
    input.previousSnapshotCount
  );

  const tensions = detectTensions(input);
  const strengths = detectStrengths(input);
  const watchAreas = detectWatchAreas(input);

  // Assemble cards in narrative order
  const cards: InsightCard[] = [];

  // 1. Headline — always present
  cards.push(
    buildHeadlineCard(
      input,
      archetypeResult.title,
      archetypeResult.description,
      overallTrend
    )
  );

  // 2. Strengths — at most 2, only when they add non-obvious information
  for (const s of strengths) {
    cards.push(buildStrengthCard(s));
  }

  // 3. Tensions — highest priority informational cards
  for (const t of tensions) {
    cards.push(buildTensionCard(t));
  }

  // 4. Trajectory — only when meaningful
  const trajectoryCard = buildTrajectoryCard(input, overallTrend);
  if (trajectoryCard) cards.push(trajectoryCard);

  // 5. Confidence — only when below high
  const confidenceCard = buildConfidenceCard(input, confidence);
  if (confidenceCard) cards.push(confidenceCard);

  // 6. Watch areas — only if not already covered by tensions
  const tensionKeys = new Set(tensions.map((t) => t.key));
  for (const area of watchAreas) {
    // Suppress watch areas that are semantically redundant with detected tensions
    const redundant =
      (area.key === "weak_impact" && tensionKeys.has("activity_impact_gap")) ||
      (area.key === "weak_impact" && tensionKeys.has("activity_impact_gap_moderate")) ||
      (area.key === "weak_reach" && tensionKeys.has("consistency_reach_gap"));
    if (!redundant) cards.push(buildWatchAreaCard(area));
  }

  // Enforce 3–6 card ceiling, sorted by priority
  const finalCards = cards
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 6);

  const keySignals = deriveKeySignals(tensions, strengths);
  const warnings = deriveWarnings(watchAreas);

  return {
    archetype: archetypeResult.archetype,
    archetypeTitle: archetypeResult.title,
    trendLabel: overallTrend,
    cards: finalCards,
    keySignals,
    warnings,
  };
}