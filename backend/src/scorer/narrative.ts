// =============================================================
// narrative.ts — Layer 6: Narrative Fusion Engine
//
// Generates human-readable insight strings from scored layers.
// All strings are deterministic — no LLM calls, no randomness.
// =============================================================

import type {
  L2Features, L3Temporal, L4Cohort, L5Composite,
  L1QualitySignals, L6Narrative, TensionType,
  Archetype, MomentumLabel, ConfidenceLevel,
} from "./types.js";

// =============================================================
// TENSION DETECTION
//
// Tension = a meaningful contradiction between two sub-scores
// that implies something diagnostically interesting.
// =============================================================
function detectTension(
  l2: L2Features,
  l3: L3Temporal,
  prevSubScores?: HistoricalSubScores
): TensionType {
  // High activity but impact is falling (or was already low)
  if (l3.activity > 55 && l3.impact < 30) {
    return "high_activity_declining_impact";
  }

  // High impact (reputation) but activity has cooled
  if (l3.impact > 60 && l3.activity < 30) {
    return "high_impact_declining_activity";
  }

  // Activity is falling but reach (followers) is growing — lagging signal
  if (l3.activity < 30 && l3.reach > 55) {
    return "rising_reach_no_output";
  }

  // More commits but PR quality signals dropped
  if (prevSubScores) {
    const activityGrew  = l3.activity  > prevSubScores.activity  * 1.1;
    const qualityFell   = l3.quality   < prevSubScores.quality   * 0.85;
    if (activityGrew && qualityFell) {
      return "quality_activity_divergence";
    }

    // Usually consistent, but burst detected this period
    const wasConsistent = prevSubScores.consistency > 55;
    const burstNow      = l2.activityVariancePenalty > 20;
    if (wasConsistent && burstNow) {
      return "consistency_burst_conflict";
    }
  }

  return "none";
}

// ── Tension descriptions ──────────────────────────────────────
const TENSION_DESCRIPTIONS: Record<TensionType, string | null> = {
  high_activity_declining_impact:
    "High commit volume but low ecosystem impact suggests activity may be concentrated in low-visibility or internal work. Consider increasing open-source contribution breadth.",
  high_impact_declining_activity:
    "Strong reputation built on past work, but recent activity has cooled. This profile may be in a maintenance or planning phase.",
  rising_reach_no_output:
    "Follower count is growing faster than output — reputation is outpacing current productivity. This is common after a viral project, but momentum risk is rising.",
  quality_activity_divergence:
    "Activity volume increased but PR merge rates and review participation declined. More output with lower signal-to-noise ratio.",
  consistency_burst_conflict:
    "Normally consistent contributor showing an unusual activity spike. Could indicate a hackathon, deadline push, or anomalous data.",
  none: null,
};

// =============================================================
// ARCHETYPE HEADLINES
// =============================================================
const ARCHETYPE_HEADLINES: Record<Archetype, (score: number) => string> = {
  elite:            (s) => `Elite-tier developer — top ${100 - Math.round(s)}th percentile composite.`,
  framework_author: (_) => "Framework author profile — high ecosystem leverage with broad downstream impact.",
  infra_engineer:   (_) => "Infrastructure engineer — deep quality signals with strong consistency.",
  research_dev:     (_) => "Research-oriented developer — high-complexity, specialized contributions.",
  maintainer:       (_) => "Open-source maintainer — consistent, review-heavy, broad contribution pattern.",
  builder:          (_) => "Prolific builder — high shipping velocity with room to grow review depth.",
  impact_dev:       (_) => "High-impact developer — strong reputation with a lower current activity pace.",
  rising_dev:       (_) => "Rising contributor — accelerating momentum with growing output quality.",
  balanced:         (_) => "Well-rounded profile — signals distributed evenly across dimensions.",
  ghost:            (_) => "Dormant profile — minimal recent signals across all dimensions.",
};

// =============================================================
// STRENGTH GENERATORS
// =============================================================
function buildStrengths(
  l3: L3Temporal,
  l1: L1QualitySignals,
  l5: L5Composite
): string[] {
  const strengths: string[] = [];

  if (l3.activity > 65)
    strengths.push(`High activity rate (${Math.round(l3.activity)}/100) — consistently shipping.`);

  if (l3.impact > 65)
    strengths.push(`Strong ecosystem impact (${Math.round(l3.impact)}/100) — work is referenced and adopted.`);

  if (l1.prMergeRate > 0.75)
    strengths.push(`High PR merge rate (${Math.round(l1.prMergeRate * 100)}%) — contributions are well-targeted.`);

  if (l1.reviewParticipationRate > 0.60)
    strengths.push(`Strong review participation — collaborates actively beyond own PRs.`);

  if (l3.consistency > 60)
    strengths.push(`Consistent contribution pattern — low variance in weekly output.`);

  if (l3.momentumLabel === "accelerating")
    strengths.push(`Positive velocity trend — score trajectory is accelerating.`);

  if (l1.repoBreadthScore > 0.65)
    strengths.push(`Broad repository footprint — contributions span multiple active projects.`);

  if (l3.reach > 60)
    strengths.push(`High reach (${Math.round(l3.reach)}/100) — strong community presence.`);

  return strengths.slice(0, 4); // cap at 4
}

// =============================================================
// WATCH AREA GENERATORS
// =============================================================
function buildWatchAreas(
  l2: L2Features,
  l3: L3Temporal,
  l1: L1QualitySignals,
  tension: TensionType
): string[] {
  const areas: string[] = [];

  if (l2.spamPenaltyApplied)
    areas.push("Activity spam signals detected — high push-to-merge ratio or low-substance commits.");

  if (l1.spamFlags.singleRepoConcentration)
    areas.push("Over 80% of pushes concentrated in a single repository — consider diversifying contributions.");

  if (l3.momentumLabel === "volatile")
    areas.push("Volatile score trajectory — activity spikes without sustained follow-through.");

  if (l3.heatScore < 0.30)
    areas.push("Low recency heat — profile may be entering a dormant period.");

  if (l1.prMergeRate < 0.35 && l3.activity > 40)
    areas.push(`Low PR merge rate (${Math.round(l1.prMergeRate * 100)}%) despite high activity — review contribution targeting.`);

  if (tension !== "none")
    areas.push("Score tension detected — see tension analysis below.");

  return areas.slice(0, 4);
}

// =============================================================
// TRAJECTORY STATEMENT
// =============================================================
function buildTrajectory(l3: L3Temporal, shapedScore: number): string {
  const score = Math.round(shapedScore);
  const vel   = Math.round(l3.velocity * 10) / 10;
  const heat  = Math.round(l3.heatScore * 100);

  if (l3.momentumLabel === "accelerating") {
    return `Score is climbing (+${vel} pts/snapshot EMA). At current velocity, the ${score >= 80 ? "elite" : score >= 60 ? "strong" : "average"} band is within reach.`;
  }
  if (l3.momentumLabel === "decelerating") {
    return `Score is declining (${vel} pts/snapshot EMA). Recency heat at ${heat}% — re-engaging with consistent contributions would arrest this trend.`;
  }
  if (l3.momentumLabel === "volatile") {
    return `Trajectory is erratic — acceleration detected but high score volatility (σ=${Math.round(l3.volatility * 10) / 10}) dampens confidence in the trend. Consistent output over 4+ weeks would stabilize this reading.`;
  }
  return `Score is stable around ${score}. Recency heat at ${heat}%.`;
}

// =============================================================
// CONFIDENCE STATEMENT
// =============================================================
const CONFIDENCE_STATEMENTS: Record<ConfidenceLevel, (ci: [number, number], n: number) => string> = {
  very_low: (ci, n) =>
    `Very low confidence (${n} snapshot${n === 1 ? "" : "s"}). Score range is wide: [${ci[0]}–${ci[1]}]. Interpret with caution — 4+ snapshots are needed for stable signals.`,
  low: (ci, n) =>
    `Low confidence (${n} snapshots). Estimated score range: [${ci[0]}–${ci[1]}]. Pattern is emerging but not yet reliable.`,
  medium: (ci, n) =>
    `Medium confidence (${n} snapshots). Score range: [${ci[0]}–${ci[1]}]. Main trends are visible; outlier snapshots may still shift the reading.`,
  high: (ci, n) =>
    `High confidence (${n} snapshots). Score range: [${ci[0]}–${ci[1]}]. Signals are stable and reliable.`,
  very_high: (ci, n) =>
    `Very high confidence (${n} snapshots). Narrow score range: [${ci[0]}–${ci[1]}]. Long-term pattern is well-established.`,
};

// =============================================================
// Historical sub-scores shape (for tension detection)
// =============================================================
type HistoricalSubScores = {
  activity: number;
  impact: number;
  quality: number;
  consistency: number;
  reach: number;
};

// =============================================================
// MAIN EXPORT — computeNarrative
// =============================================================
export function computeNarrative(
  l1: L1QualitySignals,
  l2: L2Features,
  l3: L3Temporal,
  l4: L4Cohort,
  l5: L5Composite,
  snapshotCount: number,
  prevSubScores?: HistoricalSubScores
): L6Narrative {
  const tension = detectTension(l2, l3, prevSubScores);
  const tensionDescription = TENSION_DESCRIPTIONS[tension];

  const archetypeHeadline = ARCHETYPE_HEADLINES[l5.archetype](l5.shapedScore);

  const percentileClause = l4.percentileRank !== null
    ? ` Ranks in the top ${Math.round(100 - l4.percentileRank)}% of ${l4.cohortLabel}.`
    : "";

  const headline = archetypeHeadline + percentileClause;

  const strengths  = buildStrengths(l3, l1, l5);
  const watchAreas = buildWatchAreas(l2, l3, l1, tension);

  const trajectoryStatement = buildTrajectory(l3, l5.shapedScore);
  const confidenceStatement = CONFIDENCE_STATEMENTS[l5.confidenceLevel](
    l5.confidenceInterval,
    snapshotCount
  );

  return {
    headline,
    tension,
    tensionDescription,
    strengths,
    watchAreas,
    trajectoryStatement,
    confidenceStatement,
  };
}