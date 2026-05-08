// =============================================================
// layers.ts — The 4-Layer V3 Scoring Architecture
// =============================================================

import { sig, clamp, decay, cov, mean, stdDev, shapeDistribution } from "./math.js";
import type {
  NormalizedProfile,
  WeeklySlice,
  L1Signals,
  L2Features,
  L3Decayed,
  L4Result,
  Archetype,
  HistoricalEntry,
} from "./types.js";

// ─── Constants ────────────────────────────────────────────────

/** Sigmoid anchor constants (k values). See math.ts:sig for derivation. */
const K = {
  pushes:    60,  // ~60 pushes/month  = active mid-tier
  prs:       25,  // ~25 PRs/month     = solid contributor
  issues:    20,  // ~20 issues/month  = engaged
  releases:   5,  // ~5 releases/month = ships product
  // Impact anchors are set LOW intentionally:
  // sig(0, k) ≈ 0.018 collapses at zero — anchoring at the
  // median of real GitHub repos (not top-1%) prevents collapse
  // for active devs with modest-but-real projects.
  stars:      5,  // ~5 stars   = has at least some traction (median real-world)
  repos:     15,  // ~15 repos  = established portfolio (halved — most devs have 5–20)
  forks:      3,  // ~3 forks   = others build on work (realistic median)
  followers:  20, // ~20 followers = small but real audience
} as const;

/** Decay half-life in days. e^(-30/10) ≈ 0.05 so 30-day-old = 5% weight. */
const DECAY_HALF_LIFE = 10;

/** Anti-exploit thresholds */
const SPAM_PUSH_TO_PR_THRESHOLD = 15; // pushes:PRs ratio above this = spam flag
const BURST_RATIO_THRESHOLD = 3.0;    // peak week > 3× average = burst flag    // peak week > 4× average = burst flag

// ─────────────────────────────────────────────────────────────
// LAYER 1 — Raw Signal Extraction
//
// Reads the normalizedProfile and returns raw numbers.
// No transformation here — pure passthrough for auditability.
// ─────────────────────────────────────────────────────────────

export function layer1(profile: NormalizedProfile): L1Signals {
  const a = profile.activity_30d;
  return {
    pushes:    a.pushes    ?? 0,
    prs:       a.prs       ?? 0,
    issues:    a.issues    ?? 0,
    releases:  a.releases  ?? 0,
    stars:     profile.stars     ?? 0,
    repos:     profile.repos     ?? 0,
    forks:     profile.forks     ?? 0,
    followers: profile.followers ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — Bounded Sigmoid Features
//
// Converts raw signals → bounded 0–100 sub-scores using the
// calibrated sig(x/k) formula. Each sub-score has explicit
// weights that sum to 100.
//
// Anti-exploit guards applied here before aggregation.
// ─────────────────────────────────────────────────────────────

export function layer2(
  l1: L1Signals,
  weeklySlices: WeeklySlice[] = []
): L2Features {
  // ── Activity (max=100) ────────────────────────────────────
  //   pushes×40 + prs×30 + issues×15 + releases×15
  //   prs are weighted higher than pushes (per-unit value).
  //   releases are weighted equal to issues (rare but meaningful).
  const rawActivity = clamp(
    sig(l1.pushes,   K.pushes)   * 40 +
    sig(l1.prs,      K.prs)      * 30 +
    sig(l1.issues,   K.issues)   * 15 +
    sig(l1.releases, K.releases) * 15
  );

  // ── Consistency Variance Penalty ─────────────────────────
  //   Uses weekly push distribution to detect bursty patterns.
  //   CoV (stdDev/mean) of weekly pushes:
  //     = 0   → no penalty (perfectly consistent)
  //     = 1   → 20-point penalty
  //     ≥ 2   → 40-point cap penalty (extreme burst)
  //
  //   When no weekly data, penalty defaults to 0 (benefit of the doubt).
  let activityVariancePenalty = 0;
  let pushToPrRatio = 0;
  let burstRatio = 0;
  let spamPenaltyApplied = false;

  if (weeklySlices.length >= 2) {
    const weeklyPushes = weeklySlices.map((w) => w.pushes);
    const weeklyMean = mean(weeklyPushes);
    const weeklyCoV = cov(weeklyPushes);

    // Variance penalty: linear scaling, capped at 40
    activityVariancePenalty = clamp(weeklyCoV * 20, 0, 40);

    // Burst ratio: peak week vs average
    const peakWeek = Math.max(...weeklyPushes);
    burstRatio = weeklyMean > 0 ? peakWeek / weeklyMean : 0;
  }

  // ── Anti-Spam: Push-to-PR ratio ───────────────────────────
  //   High pushes with very few PRs = mechanical commit spam.
  //   Penalty: reduce activity score by 25% when ratio > threshold.
  //   Guard: only triggers when prs > 0 (prs=0 handled separately).
  if (l1.prs > 0) {
    pushToPrRatio = l1.pushes / l1.prs;
  } else if (l1.pushes > 20) {
    // Many pushes, zero PRs = definitive spam signal
    pushToPrRatio = l1.pushes; // treated as worst-case ratio
  }

  if (pushToPrRatio > SPAM_PUSH_TO_PR_THRESHOLD) {
    spamPenaltyApplied = true;
    activityVariancePenalty = Math.max(activityVariancePenalty, 20); // enforce minimum 20pt penalty
  }

  const consistency = clamp(rawActivity - activityVariancePenalty);

  // ── Impact (max=100) ─────────────────────────────────────
  //   stars×60 + repos×25 + forks×15
  //
  //   KEY FIX vs V2: sig(x/k) has a floor at sig(0)=0.5.
  //   stars=2 → sig(2/20) = sig(0.10) → sigmoid(-3.6) ≈ 0.526
  //   So min impact contribution from stars alone ≈ 0.526×60 = 31.6
  //   vs V2's sigmoid(log10(3), 1.8, 2.5) ≈ 0.025 × 60 = 1.5
  //
  //   This correctly prevents "active users near zero impact" bug.
  const impact = clamp(
    sig(l1.stars,  K.stars)  * 60 +
    sig(l1.repos,  K.repos)  * 25 +
    sig(l1.forks,  K.forks)  * 15
  );

  // ── Reach (max=100) ──────────────────────────────────────
  //   followers×60 + repos×40
  //   Repos contribute to reach (discoverability) as well as impact.
  const reach = clamp(
    sig(l1.followers, K.followers) * 60 +
    sig(l1.repos,     K.repos)     * 40
  );

  return {
    activity: rawActivity,
    impact,
    consistency,
    reach,
    activityVariancePenalty,
    pushToPrRatio,
    burstRatio,
    spamPenaltyApplied,
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — Temporal Decay
//
// Applies a recency multiplier to L2 sub-scores rather than
// recomputing from weekly slices. This preserves the signal
// magnitude established in L2 and applies decay as a scalar.
//
// Design rationale:
//   Recomputing activity from per-week slices using the same
//   30-day k-anchors causes collapse: sig(55 pushes, k=60)=0.47,
//   meaning even an elite week looks "below average". Instead:
//
//   1. Compute a recency multiplier from the decay-weighted
//      ratio of recent-to-total activity mass.
//   2. Apply that multiplier to L2 scores.
//
// Decay rates:
//   Activity/consistency: fast (halfLife=10d) — momentum signal
//   Impact/reach:         slow (halfLife=30d) — reputation persists
// ─────────────────────────────────────────────────────────────

export function layer3(
  l2: L2Features,
  weeklySlices: WeeklySlice[] = []
): L3Decayed {
  const IMPACT_HALF_LIFE = 30;

  // ── No weekly data: bulk decay for activity only ────────────
  //
  // Impact/reach are point-in-time state (stars, repos, followers).
  // They represent accumulated reputation — not event streams.
  // A repo that has 500 stars today has 500 stars regardless of
  // when those stars were earned. Do NOT decay them.
  //
  // Activity/consistency are event-based (pushes, PRs happen in time).
  // Without weekly granularity, apply a mild 0.75 penalty to reflect
  // that we can't confirm activity is recent.
  if (weeklySlices.length === 0) {
    const activityFactor = 0.75;
    return {
      activity:     l2.activity    * activityFactor,
      impact:       l2.impact,       // no decay — accumulated state
      consistency:  l2.consistency  * activityFactor,
      reach:        l2.reach,        // no decay — accumulated state
      recencyScore: 0.5,
    };
  }

  // ── With weekly data: compute recency multiplier ──────────────
  //
  // Recency multiplier = decay-weighted activity fraction in last 2 weeks
  // divided by the total decay-weighted activity.
  // This gives a value in (0,1] that scales proportionally to how
  // recently the bulk of the activity occurred.
  //
  // A dev with all activity in week 0 → multiplier ≈ 1.0 (max recency)
  // A dev with all activity in week 3 → multiplier ≈ 0.5 (stale)

  let totalDecayMass   = 0;
  let recentDecayMass  = 0;

  for (const slice of weeklySlices) {
    const ageDays     = slice.weekOffset * 7;
    const w           = decay(ageDays, DECAY_HALF_LIFE);
    // Weight each week proportionally to its activity volume
    const weekVolume  = slice.pushes + slice.prs * 2 + slice.issues + slice.releases * 3;
    totalDecayMass   += w * weekVolume;
    if (slice.weekOffset <= 1) recentDecayMass += w * weekVolume;
  }

  // If no activity in any week, use a neutral 0.65 multiplier
  const recencyScore = totalDecayMass > 0
    ? clamp(recentDecayMass / totalDecayMass, 0, 1)
    : 0.65;

  // Activity multiplier: blend recency into a [0.5, 1.0] range.
  // Even fully-stale activity (recency=0) keeps 50% of its L2 value
  // to avoid punishing developers who had a good month but took a break.
  const activityMultiplier = 0.5 + recencyScore * 0.5;
  const impactMultiplier   = decay(15, IMPACT_HALF_LIFE); // fixed ≈ 0.607

  return {
    activity:     l2.activity    * activityMultiplier,
    impact:       l2.impact,       // no decay — accumulated state
    consistency:  l2.consistency  * activityMultiplier,
    reach:        l2.reach,        // no decay — accumulated state
    recencyScore,
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 4 — Final Composite + Distribution Shaping
//
// Weights:  Activity 30% | Impact 35% | Consistency 20% | Reach 15%
//
// Distribution shaping via sigmoid re-centering:
//   shaped = sigmoid((x/100 - 0.5) * 6) * 100
//
// This produces the target bands:
//   0–30:  weak   (below-average signals, compressed down)
//   30–60: average
//   60–80: strong
//   80–100: elite (tail expanded)
// ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  activity:    0.30,
  impact:      0.35,
  consistency: 0.20,
  reach:       0.15,
} as const;

function classifyArchetype(
  l2: L2Features,
  l3: L3Decayed,
  finalScore: number
): Archetype {
  const { activity, impact, consistency, reach } = l3;

  // Elite: top band regardless of sub-score pattern
  if (finalScore >= 85) return "elite";

  // Ghost: very low signal across ALL dimensions
  if (activity < 20 && impact < 20 && consistency < 15 && reach < 15)
    return "ghost";

  // Impact-led: large accumulated reputation, modest recent activity
  // (e.g. library author with many stars but irregular commits)
  if (impact > 60 && activity < 40) return "impact_dev";

  // Maintainer: consistent activity + decent impact.
  // Threshold lowered (40/40/35) to match real L3 output ranges
  // where weekly decay compresses activity to 40–65 even for prolific devs.
  if (activity > 40 && consistency > 40 && impact > 35) return "maintainer";

  // Builder: high activity but inconsistency (bursty, low polish)
  if (activity > 45 && consistency < 35 && !l2.spamPenaltyApplied)
    return "builder";

  // Rising: mid-range score, no spam, positive reach signals
  if (!l2.spamPenaltyApplied && finalScore >= 40 && finalScore < 70)
    return "rising_dev";

  return "balanced";
}

export function layer4(
  l3: L3Decayed,
  l2: L2Features,
  history: HistoricalEntry[],
  snapshotCount: number
): L4Result {
  // Weighted composite (0–100 range input)
  const rawComposite =
    l3.activity    * WEIGHTS.activity    +
    l3.impact      * WEIGHTS.impact      +
    l3.consistency * WEIGHTS.consistency +
    l3.reach       * WEIGHTS.reach;

  // Distribution shaping — stretches tails, compresses mid-range
  const finalScore = shapeDistribution(rawComposite);

  // ── Trend (EMA-based) ─────────────────────────────────────
  //   EMA smooths the current score against the previous to
  //   dampen single-snapshot noise.
  //   trend = EMA(current, previous) - previous
  //         = (0.7 * current + 0.3 * previous) - previous
  //         = 0.7 * (current - previous)
  //
  //   So trend is always 70% of the raw delta — conservative.
  //   Positive = improving, negative = declining.
  let trend = 0;
  let trendLabel: L4Result["trendLabel"] = "stable";

  if (history.length >= 1) {
    const previous = history[history.length - 1]!.totalScore;
    // EMA: α=0.7 weights current score heavily
    trend = 0.7 * (finalScore - previous);

    if (trend > 2)  trendLabel = "accelerating";
    if (trend < -2) trendLabel = "decelerating";
  }

  // ── Confidence ────────────────────────────────────────────
  const conf = clamp(
    Math.log(snapshotCount + 1) / Math.log(20),
    0, 1
  );

  const archetype = classifyArchetype(l2, l3, finalScore);

  return {
    rawComposite,
    finalScore,
    archetype,
    confidence: Math.round(conf * 1000) / 1000,
    trend:      Math.round(trend * 100) / 100,
    trendLabel,
  };
}