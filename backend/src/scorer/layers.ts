// =============================================================
// layers.ts — All 6 scoring layers
// =============================================================

import {
  sig, clamp, clamp01, decay, ageNormFactor,
  mean, stdDev, cov, emaSeries, shapeDistribution,
  percentileRank as pctRank, confidenceInterval, confidenceScore, confidenceLevel,
  ε,
} from "./math.js";

import type {
  EnrichedSnapshot, HistoricalScore,
  L0Hygiene, L1QualitySignals, L2Features,
  L3Temporal, L4Cohort, L5Composite,
  Archetype, MomentumLabel,
} from "./types.js";

// ─── Sigmoid anchor constants ─────────────────────────────────
// Each k = realistic 50th-percentile value for that signal.
const K = {
  // Activity (per 30 days)
  pushes:   30,   // median active dev: ~30 pushes/month
  prs:      8,    // median: ~8 PRs/month
  issues:   10,   // median: ~10 issues/month
  releases: 2,    // median: ~2 releases/month

  // Impact (cumulative)
  stars:    10,   // median public repo: ~10 stars total
  repos:    12,   // median: ~12 public repos
  forks:    3,    // median: ~3 forks

  // Reach
  followers: 15,  // median: ~15 followers

  // Quality
  prMergeRate:    0.60, // 60% merge rate = solid
  reviewRatio:    0.40, // 40% reviews/PRs = collaborative
  commitSubstance: 0.50, // substance score midpoint
} as const;

// ── Decay half-lives ──────────────────────────────────────────
const τ_fast = 14;  // days — event recency
const τ_slow = 90;  // days — presence heat

// ── Archetype weight presets ──────────────────────────────────
// [activity, impact, quality, consistency, reach]
type WeightVector = {
  activity: number; impact: number; quality: number;
  consistency: number; reach: number;
};

const ARCHETYPE_WEIGHTS: Record<Archetype, WeightVector> = {
  elite:            { activity: 0.20, impact: 0.30, quality: 0.20, consistency: 0.15, reach: 0.15 },
  framework_author: { activity: 0.15, impact: 0.40, quality: 0.20, consistency: 0.10, reach: 0.15 },
  infra_engineer:   { activity: 0.25, impact: 0.25, quality: 0.30, consistency: 0.15, reach: 0.05 },
  research_dev:     { activity: 0.15, impact: 0.35, quality: 0.35, consistency: 0.10, reach: 0.05 },
  maintainer:       { activity: 0.20, impact: 0.20, quality: 0.25, consistency: 0.25, reach: 0.10 },
  builder:          { activity: 0.35, impact: 0.20, quality: 0.15, consistency: 0.20, reach: 0.10 },
  impact_dev:       { activity: 0.15, impact: 0.45, quality: 0.15, consistency: 0.10, reach: 0.15 },
  rising_dev:       { activity: 0.30, impact: 0.20, quality: 0.20, consistency: 0.15, reach: 0.15 },
  balanced:         { activity: 0.25, impact: 0.25, quality: 0.20, consistency: 0.20, reach: 0.10 },
  ghost:            { activity: 0.25, impact: 0.25, quality: 0.20, consistency: 0.20, reach: 0.10 },
};

// =============================================================
// LAYER 0 — Data Hygiene & Age Normalization
// =============================================================
export function layer0(snapshot: EnrichedSnapshot): L0Hygiene {
  const warnings: string[] = [];

  const accountAgeDays = Math.max(1,
    (snapshot.takenAt.getTime() - snapshot.profile.accountCreatedAt.getTime())
    / 86_400_000
  );

  const normFactor = ageNormFactor(accountAgeDays);

  // Data quality scoring
  let quality = 1.0;
  const hasCommitSignals = !!snapshot.commitSignals;
  const hasPRSignals     = !!snapshot.prSignals;
  const hasRepoBreadth   = snapshot.repoStats.repos.length > 0;

  if (!hasCommitSignals) { quality -= 0.15; warnings.push("commitSignals missing — quality layer uses defaults"); }
  if (!hasPRSignals)     { quality -= 0.10; warnings.push("prSignals missing — PR quality defaults to neutral"); }
  if (!hasRepoBreadth)   { quality -= 0.10; warnings.push("per-repo data missing — breadth score unavailable"); }
  if (snapshot.weeklyActivity.length === 0) {
    quality -= 0.10;
    warnings.push("weeklyActivity missing — temporal decay uses bulk fallback");
  }

  return {
    accountAgeDays,
    ageNormFactor: normFactor,
    dataQualityScore: clamp01(quality),
    hasCommitSignals,
    hasPRSignals,
    hasRepoBreadth,
    warnings,
  };
}

// =============================================================
// LAYER 1 — Quality Signal Extraction
// =============================================================
export function layer1(
  snapshot: EnrichedSnapshot,
  l0: L0Hygiene
): L1QualitySignals {
  // ── PR Quality ────────────────────────────────────────────
  const cs  = snapshot.commitSignals;
  const prs = snapshot.prSignals;

  const prMergeRate = prs
    ? clamp01(prs.merged / (prs.opened + ε))
    : 0.50; // neutral default

  const reviewParticipationRate = prs
    ? clamp01(prs.reviewed / (prs.opened + ε))
    : 0.30; // neutral default

  // ── Commit Substance ──────────────────────────────────────
  // Combines: average lines changed (substance proxy),
  //           test file ratio (quality signal),
  //           refactor ratio (clean-up signal, positive but capped)
  let commitSubstanceScore = 0.50; // neutral default
  if (cs) {
    const sizeScore    = sig(cs.avgLinesChanged, 50);   // 50 lines = mid-tier
    const testBonus    = cs.testFileRatio * 0.20;
    const refactorBump = Math.min(cs.refactorRatio * 0.15, 0.10); // capped bonus
    commitSubstanceScore = clamp01(sizeScore * 0.70 + testBonus + refactorBump);
  }

  // ── Repo Breadth ──────────────────────────────────────────
  // Penalizes concentration: if >80% pushes in one repo, flag + penalize.
  const repos = snapshot.repoStats.repos;
  let repoBreadthScore = 0.50;
  let singleRepoConcentration = false;

  if (repos.length > 0) {
    const totalPushes = repos.reduce((s, r) => s + r.pushCount, 0);
    const maxRepoPushes = Math.max(...repos.map(r => r.pushCount));
    const concentration = totalPushes > 0 ? maxRepoPushes / totalPushes : 0;

    singleRepoConcentration = concentration > 0.80;

    // Breadth score: more unique active repos = higher score,
    // penalized by concentration
    const activeRepos = repos.filter(r => r.isActive).length;
    const breadthRaw  = sig(activeRepos, 5); // 5 active repos = mid-tier
    repoBreadthScore  = clamp01(breadthRaw * (1 - concentration * 0.5));
  }

  // ── Repo Ecosystem Importance ─────────────────────────────
  // Weights: stars 40%, dependents 35%, pkg complexity 25%
  let repoImportanceScore = 0.30; // default: modest importance
  if (repos.length > 0) {
    const importanceScores = repos.map(r =>
      sig(r.stars,      50)  * 0.40 +
      sig(r.dependents, 100) * 0.35 +
      sig(r.pkgComplexity, 10) * 0.25
    );
    repoImportanceScore = clamp01(mean(importanceScores));
  }

  // ── Spam Flags ────────────────────────────────────────────
  const totalPushes = snapshot.activity_30d.pushes;
  const totalMerged = prs?.merged ?? 0;
  const avgLines    = cs?.avgLinesChanged ?? 999; // unknown = assume OK

  const lowSubstanceCommits      = cs ? avgLines < 5 : false;
  const pushToMergeRatioAnomaly  = totalPushes > 30 && totalMerged === 0;

  return {
    prMergeRate,
    reviewParticipationRate,
    commitSubstanceScore,
    repoBreadthScore,
    repoImportanceScore,
    spamFlags: {
      singleRepoConcentration,
      lowSubstanceCommits,
      pushToMergeRatioAnomaly,
    },
  };
}

// =============================================================
// LAYER 2 — Bounded Feature Scoring
// =============================================================
export function layer2(
  snapshot: EnrichedSnapshot,
  l0: L0Hygiene,
  l1: L1QualitySignals
): L2Features {
  const a  = snapshot.activity_30d;
  const rs = snapshot.repoStats;
  const p  = snapshot.profile;

  // Age-normalized push count: prevents legacy advantage
  const ageNormPushes = a.pushes * l0.ageNormFactor * 30; // scale back to /30d unit

  // ── Activity (0–100) ─────────────────────────────────────
  // Uses age-normalized pushes to prevent old-account inflation.
  const rawActivity = clamp(
    sig(ageNormPushes,  K.pushes)   * 35 +
    sig(a.prs,         K.prs)       * 30 +
    sig(a.issues,      K.issues)    * 20 +
    sig(a.releases,    K.releases)  * 15
  );

  // ── Impact (0–100) ────────────────────────────────────────
  // Point-in-time state — not decayed (see v3 design doc).
  const impact = clamp(
    sig(rs.totalStars, K.stars)  * 50 +
    sig(rs.totalRepos, K.repos)  * 25 +
    sig(rs.totalForks, K.forks)  * 25
  );

  // ── Quality (0–100) ── NEW LAYER ─────────────────────────
  // Captures the *how*, not just the *how much*.
  const quality = clamp(
    sig(l1.prMergeRate,             K.prMergeRate)    * 35 +
    sig(l1.reviewParticipationRate, K.reviewRatio)    * 25 +
    l1.commitSubstanceScore                           * 25 * 100 +  // already 0–1
    l1.repoBreadthScore                               * 15 * 100    // already 0–1
  ) / 100; // re-normalise the mixed units

  const qualityScore = clamp(quality * 100);

  // ── Consistency (0–100) ───────────────────────────────────
  const weeklyPushes = snapshot.weeklyActivity.map(w => w.pushes);
  let activityVariancePenalty = 0;
  if (weeklyPushes.length >= 2) {
    const weeklyCoV = cov(weeklyPushes);
    activityVariancePenalty = clamp(weeklyCoV * 20, 0, 40);
  }
  const consistency = clamp(rawActivity - activityVariancePenalty);

  // ── Reach (0–100) ─────────────────────────────────────────
  const reach = clamp(
    sig(p.followers,    K.followers) * 55 +
    sig(p.public_repos, K.repos)     * 25 +
    l1.repoImportanceScore           * 20 * 100
  ) / 100;

  const reachScore = clamp(reach * 100);

  // ── Spam penalty ──────────────────────────────────────────
  const spamFlags = l1.spamFlags;
  const spamCount = [
    spamFlags.singleRepoConcentration,
    spamFlags.lowSubstanceCommits,
    spamFlags.pushToMergeRatioAnomaly,
  ].filter(Boolean).length;

  // Each spam flag reduces activity by 15%, stacking multiplicatively
  const spamMultiplier = Math.pow(0.85, spamCount);
  const finalActivity  = clamp(rawActivity * spamMultiplier);

  return {
    activity:   finalActivity,
    impact,
    quality:    qualityScore,
    consistency,
    reach:      reachScore,
    activityVariancePenalty,
    spamPenaltyApplied: spamCount > 0,
  };
}

// =============================================================
// LAYER 3 — Temporal Engine
// =============================================================
export function layer3(
  snapshot: EnrichedSnapshot,
  l2: L2Features,
  history: HistoricalScore[]
): L3Temporal {
  // ── Recency multiplier from weekly decay ──────────────────
  const weekly = snapshot.weeklyActivity;
  let recencyScore = 0.65;  // neutral default
  let activityMultiplier = 0.75;

  if (weekly.length >= 2) {
    let totalMass = 0, recentMass = 0;
    for (const slice of weekly) {
      const ageDays   = slice.weekOffset * 7;
      const w         = decay(ageDays, τ_fast);
      const volume    = slice.pushes + slice.prs * 2 + slice.issues + slice.releases * 3;
      totalMass      += w * volume;
      if (slice.weekOffset <= 1) recentMass += w * volume;
    }
    recencyScore       = totalMass > 0 ? clamp01(recentMass / totalMass) : 0.65;
    activityMultiplier = 0.50 + recencyScore * 0.50;
  }

  // ── Heat score (slow decay from last active date) ─────────
  // Uses the most recent weekly slice as a proxy for last activity.
  const lastActiveOffset = weekly.length > 0
    ? Math.min(...weekly.filter(w => w.pushes + w.prs > 0).map(w => w.weekOffset))
    : 15; // assume 15 days inactive if unknown
  const heatScore = decay(lastActiveOffset * 7, τ_slow);

  // ── EMA Velocity + Acceleration ───────────────────────────
  // Requires at least 3 data points for meaningful acceleration.
  const scores = history.map(h => h.totalScore);

  let velocity     = 0;
  let acceleration = 0;
  let volatility   = 0;

  if (scores.length >= 2) {
    // Velocity EMA: α=0.4 (deliberate lag to smooth noise)
    const velSeries = emaSeries(
      scores.slice(1).map((s, i) => s - scores[i]!),
      0.4
    );
    velocity = velSeries.at(-1) ?? 0;

    // Acceleration EMA: α=0.3 (even more lag)
    if (velSeries.length >= 2) {
      const accSeries = emaSeries(
        velSeries.slice(1).map((v, i) => v - velSeries[i]!),
        0.3
      );
      acceleration = accSeries.at(-1) ?? 0;
    }

    volatility = stdDev(scores);
  }

  // ── Momentum score  ───────────────────────────────────────
  // M = clamp( V · (1 − λ·σ) / (mean(S) + ε) · 10,  −8, +8 )
  // λ = 0.5 — volatility dampening factor
  const λ = 0.5;
  const scoreMean = mean(scores);
  const momentumRaw =
    (velocity * (1 - λ * clamp01(volatility / 20))) /
    (scoreMean + ε) * 10;
  const momentumScore = clamp(momentumRaw, -8, 8);

  // ── Momentum label ────────────────────────────────────────
  // "volatile" if acceleration is high BUT volatility is also high
  let momentumLabel: MomentumLabel = "stable";
  if (Math.abs(acceleration) > 2 && volatility > 10) {
    momentumLabel = "volatile";
  } else if (velocity > 2) {
    momentumLabel = "accelerating";
  } else if (velocity < -2) {
    momentumLabel = "decelerating";
  }

  return {
    activity:     l2.activity    * activityMultiplier,
    impact:       l2.impact,                        // no decay — accumulated state
    quality:      l2.quality     * activityMultiplier,
    consistency:  l2.consistency * activityMultiplier,
    reach:        l2.reach,                         // no decay — accumulated state
    recencyScore,
    heatScore,
    velocity,
    acceleration,
    volatility,
    momentumScore,
    momentumLabel,
  };
}

// =============================================================
// LAYER 4 — Cohort Normalization
// =============================================================
export function layer4(
  snapshot: EnrichedSnapshot,
  rawScore: number,
  cohortPeers: number[]
): L4Cohort {
  const lang = snapshot.profile.primaryLanguage ?? "unknown";
  const cohortLabel = lang !== "unknown"
    ? `${lang} Developers`
    : "All Developers";

  // Size-tier matching: ±50% of candidate's repo count
  const candidateRepos = snapshot.repoStats.totalRepos;
  const lower = candidateRepos * 0.5;
  const upper = candidateRepos * 1.5;
  const sizedPeers = cohortPeers.filter(
    // cohortPeers are just scores — we do a simple global fallback
    // when we don't have per-peer repo counts. A real implementation
    // would accept CohortPeer[] objects with both score + metadata.
    () => true // placeholder — tier matching requires enriched peer data
  );

  const activePeers = sizedPeers.length >= 10 ? sizedPeers : cohortPeers;
  const pct = activePeers.length > 0
    ? pctRank(rawScore, activePeers)
    : null;

  return {
    cohortLabel,
    percentileRank: pct !== null ? Math.round(pct * 10) / 10 : null,
    cohortSize: activePeers.length,
    legacyCorrectionApplied: true, // age normalization in L2 handles this
  };
}

// =============================================================
// LAYER 5 — Composite + Distribution Shaping
// =============================================================
function detectArchetype(l3: L3Temporal, l1: L1QualitySignals): Archetype {
  const { activity, impact, quality, consistency, reach } = l3;

  // Ghost: near-zero *actual* output signals.
  // We check l3.activity and l3.impact (real signals) but NOT quality/reach
  // because those use neutral defaults when commit/PR data is absent.
  // The decisive signal is: did this person produce anything at all?
  const hasNoRealActivity = activity < 8 && consistency < 8;
  const hasNoRealImpact   = impact < 8;
  if (hasNoRealActivity && hasNoRealImpact) return "ghost";

  // Framework Author: very high impact + importance + decent quality
  if (impact > 65 && l1.repoImportanceScore > 0.65 && quality > 50)
    return "framework_author";

  // Research Dev: high quality/complexity, low reach, niche impact
  if (quality > 65 && reach < 30 && l1.commitSubstanceScore > 0.70)
    return "research_dev";

  // Infra Engineer: high quality, high consistency, low public stars
  if (quality > 55 && consistency > 55 && impact < 40 && reach < 35)
    return "infra_engineer";

  // Elite: top composite across multiple dimensions
  // (handled post-shaping in composite calculation)

  // Impact Dev: large reputation, lower recent activity
  if (impact > 60 && activity < 35) return "impact_dev";

  // Maintainer: consistent + quality + decent activity
  if (consistency > 45 && quality > 45 && activity > 35) return "maintainer";

  // Builder: high activity, lower quality/consistency
  if (activity > 50 && quality < 40) return "builder";

  // Rising: strong velocity signal
  if (l3.velocity > 3 && l3.momentumLabel !== "volatile") return "rising_dev";

  return "balanced";
}

export function layer5(
  l3: L3Temporal,
  l1: L1QualitySignals,
  history: HistoricalScore[],
  snapshotCount: number,
  l0: L0Hygiene
): L5Composite {
  const archetype = detectArchetype(l3, l1);
  const weights   = ARCHETYPE_WEIGHTS[archetype];

  const rawComposite =
    l3.activity    * weights.activity    +
    l3.impact      * weights.impact      +
    l3.quality     * weights.quality     +
    l3.consistency * weights.consistency +
    l3.reach       * weights.reach;

  // Add momentum — already bounded ±8
  const withMomentum = clamp(rawComposite + l3.momentumScore);

  // Elite promotion: composite ≥ 85 after shaping
  const shaped = shapeDistribution(withMomentum);
  const finalArchetype: Archetype = shaped >= 88 ? "elite" : archetype;

  // Confidence
  const conf    = confidenceScore(snapshotCount, l0.dataQualityScore);
  const confLvl = confidenceLevel(snapshotCount, l0.dataQualityScore);

  const allScores = [
    ...history.map(h => h.totalScore),
    shaped,
  ];
  const ci = confidenceInterval(allScores, shaped);

  return {
    archetype:           finalArchetype,
    weights,
    rawComposite,
    shapedScore:         shaped,
    confidenceLevel:     confLvl,
    confidenceInterval:  ci,
  };
}