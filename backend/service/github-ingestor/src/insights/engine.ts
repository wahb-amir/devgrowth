// src/insights/engine.ts

/**
 * Developer Narrative Intelligence Engine  v2.1
 *
 * Produces 3–5 high-signal cards as a coherent structured analysis.
 *
 * Key invariants:
 *   1. Score band gates all narrative capabilities (no optimism for low scores).
 *   2. ConceptRegistry enforces semantic uniqueness — no idea appears twice.
 *   3. Card order: headline → strength → tension → trajectory → confidence → watch_area
 *   4. Fully deterministic and rule-based.
 */

import { InsightCard } from "../db/models/insight.model.js";
import { classifyArchetype } from "./archetypes.js";
import type { Archetype } from "./archetypes.js";
import {
  classifyScoreBand,
  getConstrainedArchetypeTitle,
  isAllowed,
} from "./score-band.js";
import type { ScoreBand } from "./score-band.js";
import { ConceptRegistry } from "./dedup.js";
import type { ConceptKey } from "./dedup.js";

// ─── Public API types ──────────────────────────────────────────────────────────

export type EngineInput = {
  username: string;
  activityScore: number;
  impactScore: number;
  consistencyScore: number;
  reachScore: number;
  totalScore: number;
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  overallTrendScore: number;
  repos: number;
  stars: number;
  followers: number;
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
  recentSnapshotCount: number;
  previousSnapshotCount: number;
};

export type NarrativeResult = {
  archetype: Archetype;
  archetypeTitle: string;
  trendLabel: "improving" | "stable" | "declining";
  scoreBand: ScoreBand;
  cards: InsightCard[];
  keySignals: string[];
  warnings: string[];
};

// ─── Internal types ────────────────────────────────────────────────────────────

type TrendLabel = "improving" | "stable" | "declining";

type CardCandidate = {
  card: InsightCard;
  concepts: ConceptKey[];
};

// ─── Utility functions ─────────────────────────────────────────────────────────

function trendLabel(score: number): TrendLabel {
  if (score >= 0.06) return "improving";
  if (score <= -0.06) return "declining";
  return "stable";
}

function collaborationRatio(p: number, pr: number, i: number): number {
  const t = p + pr + i;
  return t === 0 ? 0 : ((pr + i) / t) * 100;
}

function confidenceTier(
  recent: number,
  previous: number,
): "high" | "medium" | "low" {
  const total = recent + previous;
  if (total >= 6 && recent >= 3) return "high";
  if (total >= 3) return "medium";
  return "low";
}

function makeCard(fields: Omit<InsightCard, never>): InsightCard {
  return fields as InsightCard;
}

// ─── Headline card ─────────────────────────────────────────────────────────────

function buildHeadlineCard(
  archetypeTitle: string,
  archetypeDescription: string,
  trend: TrendLabel,
  band: ScoreBand,
): CardCandidate {
  // Tone of the trailing trend clause is gated by band
  let trendClause: string;
  if (trend === "improving") {
    trendClause = isAllowed(band, "positive_trajectory")
      ? "Overall trajectory is positive."
      : "Some signals show early movement, though the profile is still developing.";
  } else if (trend === "declining") {
    trendClause = "Overall signals are declining.";
  } else {
    trendClause = "The profile shows no clear directional momentum.";
  }

  const type =
    trend === "improving" && isAllowed(band, "positive_trajectory")
      ? "milestone"
      : trend === "declining"
        ? "watch_area"
        : "neutral";

  return {
    card: makeCard({
      type,
      category: "overall",
      title: archetypeTitle,
      body: `${archetypeDescription} ${trendClause}`,
      relatedSubScore: "overall",
      triggerTags: ["headline", `band:${band}`, `trend:${trend}`],
      priority: 100,
    }),
    // Trajectory keys: blocks any trajectory card from duplicating the headline's directional framing.
    // overall_score_low: for low/average bands the headline already communicates weakness,
    // so a generic "overall score is low" watch area would be redundant — block it here.
    concepts: [
      "trajectory_positive",
      "trajectory_negative",
      "trajectory_mixed",
      ...(band === "low" || band === "average"
        ? ["overall_score_low" as ConceptKey]
        : []),
    ],
  };
}

// ─── Strength card ─────────────────────────────────────────────────────────────

type StrengthCandidate = {
  conceptKey: ConceptKey;
  score: number;
  body: string;
};

function detectBestStrength(
  input: EngineInput,
  band: ScoreBand,
): StrengthCandidate | null {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    pushes,
    prs,
    issues,
    activityTrend,
    impactTrend,
    repos,
    stars,
  } = input;

  const collab = collaborationRatio(pushes, prs, issues);

  // For low band the strength bar is lower — acknowledge the relative best signal
  const activityThreshold = band === "low" ? 45 : 65;
  const impactThreshold = band === "low" ? 35 : 60;
  const consisThreshold = band === "low" ? 40 : 60;
  const reachThreshold = band === "low" ? 30 : 55;

  const candidates: StrengthCandidate[] = [];

  if (activityScore >= activityThreshold) {
    const vol = pushes + prs + issues + input.releases;
    const qualifier =
      band === "low"
        ? "Activity is the strongest available signal in this profile."
        : isAllowed(band, "strong_strength_claim") && vol > 100
          ? `Contribution velocity is a standout signal, with over ${vol} tracked events in the recent window.`
          : "Contribution velocity is above the threshold for consistent engagement.";
    candidates.push({
      conceptKey: "activity_positive",
      score: activityScore,
      body: qualifier,
    });
  }

  if (impactScore >= impactThreshold) {
    const qualifier =
      band === "low"
        ? "Impact is the relatively strongest signal in this profile, though still below average overall."
        : stars >= 5
          ? "Repository engagement signals indicate meaningful visibility within the ecosystem."
          : "Contributions are generating above-average downstream engagement relative to activity volume.";
    candidates.push({
      conceptKey: "impact_positive",
      score: impactScore,
      body: qualifier,
    });
  }

  if (consistencyScore >= consisThreshold) {
    const qualifier =
      band === "low"
        ? "Contribution cadence shows early signs of regularity."
        : "Contribution cadence is stable and repeatable, with no significant gaps in the measured period.";
    candidates.push({
      conceptKey: "consistency_positive",
      score: consistencyScore,
      body: qualifier,
    });
  }

  if (reachScore >= reachThreshold) {
    const qualifier =
      band === "low"
        ? "Reach is developing, though still limited in absolute terms."
        : repos >= 10
          ? `Active presence across ${repos} repositories contributes to a growing public footprint.`
          : "Follower and repository engagement indicate rising public recognition.";
    candidates.push({
      conceptKey: "reach_positive",
      score: reachScore,
      body: qualifier,
    });
  }

  if (!candidates.length) return null;

  // Return the single highest-scoring strength candidate
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function buildStrengthCard(s: StrengthCandidate): CardCandidate {
  return {
    card: makeCard({
      type: "strength",
      category: "overall",
      title: "Primary signal",
      body: s.body,
      relatedSubScore: "overall",
      triggerTags: ["strength", s.conceptKey],
      priority: 85,
    }),
    concepts: [s.conceptKey],
  };
}

// ─── Tension card ──────────────────────────────────────────────────────────────

type TensionCandidate = {
  conceptKeys: ConceptKey[];
  severity: "high" | "medium";
  body: string;
};

function detectBestTension(
  input: EngineInput,
  band: ScoreBand,
): TensionCandidate | null {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    activityTrend,
    impactTrend,
    reachTrend,
    stars,
    pushes,
    prs,
    issues,
  } = input;

  const tensions: TensionCandidate[] = [];
  const collab = collaborationRatio(pushes, prs, issues);

  // Activity vs impact — the highest-value tension for this profile type
  if (activityScore >= 45 && impactScore < 33) {
    tensions.push({
      conceptKeys: ["impact_weak_vs_activity", "impact_negative"],
      severity: activityScore >= 55 ? "high" : "medium",
      body:
        band === "low"
          ? "Contribution activity is not converting into ecosystem impact. " +
            "Commit frequency is the dominant signal, but downstream engagement has not followed."
          : "Contribution volume is not translating into ecosystem impact. " +
            "Activity volume is not generating downstream engagement at a proportional rate.",
    });
  }

  // Reach lagging despite consistency
  if (consistencyScore >= 50 && reachScore < 30) {
    tensions.push({
      conceptKeys: ["reach_weak_vs_consistency", "reach_negative"],
      severity: "medium",
      body:
        "Contribution cadence is present but ecosystem visibility has not developed alongside it. " +
        "Consistent work is occurring without proportional public recognition.",
    });
  }

  // Impact improving faster than activity (positive tension — worth surfacing)
  if (
    impactTrend > activityTrend + 0.08 &&
    impactScore >= 40 &&
    isAllowed(band, "positive_trajectory")
  ) {
    tensions.push({
      conceptKeys: ["impact_positive", "activity_positive"],
      severity: "medium",
      body:
        "Impact is growing faster than activity volume, suggesting recent contributions " +
        "are landing in higher-visibility repositories or generating stronger downstream engagement.",
    });
  }

  // High reach, weak consistency
  if (reachScore >= 50 && consistencyScore < 35) {
    tensions.push({
      conceptKeys: ["reach_positive", "consistency_negative"],
      severity: "high",
      body:
        "Ecosystem visibility is not matched by consistent contribution activity. " +
        "Recognition may reflect legacy work rather than current momentum.",
    });
  }

  // Stars suggest prior impact but current scores are weak
  if (stars >= 10 && impactScore < 40) {
    tensions.push({
      conceptKeys: ["impact_negative"],
      severity: "medium",
      body:
        "Historical repository star count suggests prior visibility, " +
        "but current impact signals are weak — indicating reduced activity in those repositories.",
    });
  }

  // Low collaboration for an active developer
  if (collab < 5 && activityScore >= 50) {
    tensions.push({
      conceptKeys: ["collaboration_low"],
      severity: "medium",
      body:
        "Activity is almost entirely commit-driven with minimal pull request or issue engagement. " +
        "This limits collaborative visibility and dampens both impact and reach scoring.",
    });
  }

  if (!tensions.length) return null;

  // Prefer high severity; within same severity, first in list wins
  return tensions.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1,
  )[0];
}

function buildTensionCard(t: TensionCandidate): CardCandidate {
  return {
    card: makeCard({
      type: t.severity === "high" ? "watch_area" : "opportunity",
      category: "overall",
      title: "Signal tension",
      body: t.body,
      relatedSubScore: "overall",
      triggerTags: ["tension", `severity:${t.severity}`, ...t.conceptKeys],
      priority: t.severity === "high" ? 90 : 75,
    }),
    concepts: t.conceptKeys,
  };
}

// ─── Trajectory card ───────────────────────────────────────────────────────────

function buildTrajectoryCard(
  input: EngineInput,
  trend: TrendLabel,
  band: ScoreBand,
): CardCandidate | null {
  const {
    activityTrend,
    impactTrend,
    consistencyTrend,
    reachTrend,
    activityScore,
    impactScore,
    totalScore,
  } = input;

  // Suppress for flat profiles — nothing new to say
  if (
    Math.abs(activityTrend) < 0.05 &&
    Math.abs(impactTrend) < 0.05 &&
    Math.abs(consistencyTrend) < 0.05
  ) {
    return null;
  }

  // For low band, suppress positive trajectory claims
  if (trend === "improving" && !isAllowed(band, "positive_trajectory")) {
    return null;
  }

  const leadDim =
    impactTrend > activityTrend && impactTrend > consistencyTrend
      ? "impact"
      : activityTrend > consistencyTrend
        ? "activity"
        : "consistency";

  const lagDim =
    reachTrend < impactTrend && reachTrend < activityTrend
      ? "reach"
      : impactScore < activityScore - 20
        ? "impact"
        : null;

  let body: string;

  if (trend === "improving") {
    // Only strong/elite bands reach here
    body = lagDim
      ? `${leadDim.charAt(0).toUpperCase() + leadDim.slice(1)} is the primary growth driver, ` +
        `though ${lagDim} remains the lagging dimension. ` +
        `Closing the ${lagDim} gap will determine whether improvement compounds or levels off.`
      : `${leadDim.charAt(0).toUpperCase() + leadDim.slice(1)} is driving recent improvement. ` +
        `Overall score trajectory points upward if this signal holds.`;
  } else if (trend === "declining") {
    body =
      `Downward pressure is led by ${leadDim === "activity" ? "falling activity" : `a weakening ${leadDim} signal`}. ` +
      (totalScore > 40
        ? "The profile retains enough baseline mass that a brief recovery could stabilise the trend."
        : "At the current score level, continued decline risks reducing the profile to minimal-signal territory.");
  } else {
    body =
      `${leadDim.charAt(0).toUpperCase() + leadDim.slice(1)} is showing slight positive movement ` +
      `while ${lagDim ?? "other dimensions"} remain flat. ` +
      "No clear directional breakout is present yet.";
  }

  const conceptKey: ConceptKey =
    trend === "improving"
      ? "trajectory_positive"
      : trend === "declining"
        ? "trajectory_negative"
        : "trajectory_mixed";

  return {
    card: makeCard({
      type: "trajectory",
      category: "overall",
      title: "Trajectory",
      body,
      relatedSubScore: "overall",
      triggerTags: ["trajectory", `trend:${trend}`, `leading:${leadDim}`],
      priority: 70,
    }),
    concepts: [conceptKey],
  };
}

// ─── Confidence card ───────────────────────────────────────────────────────────

function buildConfidenceCard(
  input: EngineInput,
  tier: "high" | "medium" | "low",
  band: ScoreBand,
): CardCandidate | null {
  // Only emit when confidence is not high — no value in stating the obvious
  if (tier === "high") return null;

  const total = input.recentSnapshotCount + input.previousSnapshotCount;

  let body: string;
  if (tier === "low") {
    body =
      band === "low" || band === "average"
        ? // For low/average profiles trajectory is suppressed, so don't qualify "trajectory claims"
          `Analysis is based on ${total} snapshot${total === 1 ? "" : "s"}. ` +
          "Signal readings reflect a limited observation window and may not represent sustained patterns."
        : `Analysis is based on ${total} snapshot${total === 1 ? "" : "s"}. ` +
          "Trend and trajectory claims should be treated as provisional. " +
          "Confidence will improve as more data accumulates.";
  } else {
    body =
      `Profile history covers ${total} snapshots. ` +
      "Directional signals are reasonably reliable, though score volatility may not yet be fully captured.";
  }

  return {
    card: makeCard({
      type: "confidence",
      category: "overall",
      title: tier === "low" ? "Limited data" : "Moderate confidence",
      body,
      relatedSubScore: "overall",
      triggerTags: ["confidence", `tier:${tier}`, `snapshots:${total}`],
      priority: 60,
    }),
    concepts: ["confidence_limited"],
  };
}

// ─── Watch area card ───────────────────────────────────────────────────────────

type WatchCandidate = {
  conceptKeys: ConceptKey[];
  body: string;
};

/**
 * Returns ALL watch area candidates in specificity order (most specific first).
 * Each candidate includes "watch_area_slot" so the ConceptRegistry ensures
 * at most one watch area card is ever admitted — the first one that clears
 * dedup claims the slot and blocks the rest.
 *
 * The generic "low total score" entry comes last intentionally: for low/average
 * band profiles the headline already claims "overall_score_low", which blocks it.
 * For strong/elite profiles it never fires (totalScore >= 55). So the slot is
 * always used by a more specific signal when one exists.
 */
function detectWatchAreas(
  input: EngineInput,
  band: ScoreBand,
): WatchCandidate[] {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    activityTrend,
    consistencyTrend,
    totalScore,
    pushes,
    prs,
    issues,
  } = input;

  const collab = collaborationRatio(pushes, prs, issues);
  const candidates: WatchCandidate[] = [];

  // Specific signals first — these carry more diagnostic value

  if (reachScore < 25) {
    candidates.push({
      conceptKeys: [
        "reach_negative",
        "reach_weak_vs_reach_score",
        "watch_area_slot",
      ],
      body:
        "Ecosystem reach is minimal. Follower count and public network presence are low, " +
        "indicating the profile has not yet established a visible footprint in the ecosystem.",
    });
  }

  if (consistencyTrend < -0.08) {
    candidates.push({
      conceptKeys: ["consistency_negative", "watch_area_slot"],
      body: "Contribution regularity is deteriorating. Cadence gaps are widening compared to the prior period.",
    });
  }

  if (activityTrend < -0.08 && activityScore < 50) {
    candidates.push({
      conceptKeys: ["activity_negative", "watch_area_slot"],
      body:
        "Activity is falling from an already moderate baseline. " +
        "Without a reversal, overall score momentum will stall.",
    });
  }

  if (collab < 5 && impactScore < 35) {
    candidates.push({
      conceptKeys: ["collaboration_low", "watch_area_slot"],
      body:
        "Minimal PR and issue activity means the profile generates almost no collaborative signal, " +
        "which limits both impact and reach.",
    });
  }

  // Generic score-level catch-all — last resort.
  // For low/average profiles the headline already claims "overall_score_low",
  // so this is blocked by dedup. For strong/elite this threshold never fires.
  if (totalScore < 30) {
    candidates.push({
      conceptKeys: ["low_total_score", "overall_score_low", "watch_area_slot"],
      body:
        "Overall score is in the lower tier. " +
        "Sustained progress across activity, impact, and consistency is needed before this profile signals meaningful ecosystem presence.",
    });
  }

  return candidates;
}

function buildWatchAreaCard(w: WatchCandidate): CardCandidate {
  return {
    card: makeCard({
      type: "watch_area",
      category: "overall",
      title: "Watch area",
      body: w.body,
      relatedSubScore: "overall",
      // Exclude watch_area_slot from triggerTags — it's an internal dedup key
      triggerTags: [
        "watch_area",
        ...w.conceptKeys.filter((k) => k !== "watch_area_slot"),
      ],
      priority: 55,
    }),
    concepts: w.conceptKeys,
  };
}

// ─── Top-level helpers ─────────────────────────────────────────────────────────

function deriveKeySignals(
  strengthBody: string | null,
  tensionBody: string | null,
): string[] {
  const signals: string[] = [];
  if (strengthBody) signals.push(strengthBody.split(".")[0]);
  if (tensionBody) signals.push(tensionBody.split(".")[0]);
  return signals.slice(0, 3);
}

/** Derives warnings from the watch area card that was actually admitted, not the full candidate list. */
function deriveWarnings(admittedCards: InsightCard[]): string[] {
  const watchCard = admittedCards.find((c) =>
    c.triggerTags?.includes("watch_area"),
  );
  if (!watchCard) return [];
  return [watchCard.body.split(".")[0]];
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export function runNarrativeEngine(input: EngineInput): NarrativeResult {
  const band = classifyScoreBand(input.totalScore);
  const confidence = confidenceTier(
    input.recentSnapshotCount,
    input.previousSnapshotCount,
  );
  const trend = trendLabel(input.overallTrendScore);
  const registry = new ConceptRegistry();

  // ── Archetype ──────────────────────────────────────────────────────────────
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
    band,
  });

  // Score-band constrained display title
  const displayTitle = getConstrainedArchetypeTitle(
    band,
    archetypeResult.title,
    input.activityScore,
    input.impactScore,
    input.consistencyScore,
  );

  // ── Candidate pool ─────────────────────────────────────────────────────────
  // Build in priority order; each candidate is only admitted if its concept
  // keys have not yet been claimed.

  const candidates: CardCandidate[] = [];

  // 1. Headline — always present, claims all trajectory concept keys
  const headlineCandidate = buildHeadlineCard(
    displayTitle,
    archetypeResult.description,
    trend,
    band,
  );
  // Headline pre-claims trajectory keys so no trajectory card can duplicate the framing
  candidates.push(headlineCandidate);
  // Note: we do NOT register headline's concepts yet — trajectory card uses different
  // concepts (trajectory_positive vs trajectory_negative vs trajectory_mixed); the
  // headline only claims them as a soft reservation. See admission loop below.

  // 2. Best strength
  const strengthCandidate = detectBestStrength(input, band);
  if (strengthCandidate) {
    candidates.push(buildStrengthCard(strengthCandidate));
  }

  // 3. Best tension
  const tensionCandidate = detectBestTension(input, band);
  if (tensionCandidate) {
    candidates.push(buildTensionCard(tensionCandidate));
  }

  // 4. Trajectory — only when not redundant with headline or tension
  const trajectoryCandidate = buildTrajectoryCard(input, trend, band);
  if (trajectoryCandidate) {
    candidates.push(trajectoryCandidate);
  }

  // 5. Confidence
  const confidenceCandidate = buildConfidenceCard(input, confidence, band);
  if (confidenceCandidate) {
    candidates.push(confidenceCandidate);
  }

  // 6. Watch areas — all candidates enter the pool.
  //    "watch_area_slot" in each candidate's concepts ensures only the first
  //    non-redundant one is admitted. Ordered by specificity in detectWatchAreas.
  const watchCandidates = detectWatchAreas(input, band);
  for (const w of watchCandidates) {
    candidates.push(buildWatchAreaCard(w));
  }

  // ── Admission loop ─────────────────────────────────────────────────────────
  // Walk candidates in priority order, admitting each only if its concept
  // keys are still unclaimed.
  const sorted = candidates.sort(
    (a, b) => (b.card.priority ?? 0) - (a.card.priority ?? 0),
  );

  const admitted: InsightCard[] = [];

  for (const c of sorted) {
    if (admitted.length >= 5) break;
    if (registry.claim(c.concepts)) {
      admitted.push(c.card);
    }
  }

  // Guarantee minimum of 3: safety valve for edge cases with very sparse data
  if (admitted.length < 3) {
    for (const c of sorted) {
      if (admitted.length >= 3) break;
      if (!admitted.includes(c.card)) admitted.push(c.card);
    }
  }

  // ── Outputs ────────────────────────────────────────────────────────────────
  const strengthBody = strengthCandidate?.body ?? null;
  const tensionBody = tensionCandidate?.body ?? null;

  return {
    archetype: archetypeResult.archetype,
    archetypeTitle: displayTitle,
    trendLabel: trend,
    scoreBand: band,
    cards: admitted,
    keySignals: deriveKeySignals(strengthBody, tensionBody),
    warnings: deriveWarnings(admitted),
  };
}
