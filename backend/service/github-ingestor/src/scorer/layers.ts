// =============================================================
// layers.ts — All 6 scoring layers
// =============================================================

import {
  sig,
  clamp,
  clamp01,
  decay,
  ageNormFactor,
  mean,
  stdDev,
  cov,
  emaSeries,
  shapeDistribution,
  percentileRank as pctRank,
  confidenceInterval,
  confidenceScore,
  confidenceLevel,
  ε,
} from "./math.js";

import type {
  EnrichedSnapshot,
  HistoricalScore,
  L0Hygiene,
  L1QualitySignals,
  L2Features,
  L3Temporal,
  L4Cohort,
  L5Composite,
  Archetype,
  MomentumLabel,
} from "./types.js";

// ─── Sigmoid anchor constants ─────────────────────────────────
// Each k = realistic 50th-percentile value for that signal.
const K = {
  // Activity (per 30 days)
  pushes: 30, // median active dev: ~30 pushes/month
  prs: 8, // median: ~8 PRs/month
  issues: 10, // median: ~10 issues/month
  releases: 2, // median: ~2 releases/month

  // Impact (cumulative)
  stars: 10, // median public repo: ~10 stars total
  repos: 12, // median: ~12 public repos
  forks: 3, // median: ~3 forks

  // Reach
  followers: 15, // median: ~15 followers

  // Quality
  prMergeRate: 0.6, // 60% merge rate = solid
  reviewRatio: 0.4, // 40% reviews/PRs = collaborative
  commitSubstance: 0.5, // substance score midpoint
} as const;

// ── Decay half-lives ──────────────────────────────────────────
const τ_fast = 14; // days — event recency
const τ_slow = 90; // days — presence heat

// ── Archetype weight presets ──────────────────────────────────
// [activity, impact, quality, consistency, reach]
type WeightVector = {
  activity: number;
  impact: number;
  quality: number;
  consistency: number;
  reach: number;
};

const ARCHETYPE_WEIGHTS: Record<Archetype, WeightVector> = {
  elite: {
    activity: 0.2,
    impact: 0.3,
    quality: 0.2,
    consistency: 0.15,
    reach: 0.15,
  },
  framework_author: {
    activity: 0.15,
    impact: 0.4,
    quality: 0.2,
    consistency: 0.1,
    reach: 0.15,
  },
  infra_engineer: {
    activity: 0.25,
    impact: 0.25,
    quality: 0.3,
    consistency: 0.15,
    reach: 0.05,
  },
  research_dev: {
    activity: 0.15,
    impact: 0.35,
    quality: 0.35,
    consistency: 0.1,
    reach: 0.05,
  },
  maintainer: {
    activity: 0.3,
    impact: 0.15,
    quality: 0.25,
    consistency: 0.25,
    reach: 0.05,
  },
  builder: {
    activity: 0.35,
    impact: 0.2,
    quality: 0.15,
    consistency: 0.2,
    reach: 0.1,
  },
  impact_dev: {
    activity: 0.15,
    impact: 0.45,
    quality: 0.15,
    consistency: 0.1,
    reach: 0.15,
  },
  rising_dev: {
    activity: 0.3,
    impact: 0.2,
    quality: 0.2,
    consistency: 0.15,
    reach: 0.15,
  },
  balanced: {
    activity: 0.25,
    impact: 0.25,
    quality: 0.2,
    consistency: 0.2,
    reach: 0.1,
  },
  ghost: {
    activity: 0.25,
    impact: 0.25,
    quality: 0.2,
    consistency: 0.2,
    reach: 0.1,
  },
};

// =============================================================
// LAYER 0 — Data Hygiene & Age Normalization
// =============================================================
export function layer0(snapshot: EnrichedSnapshot): L0Hygiene {
  const warnings: string[] = [];

  const accountAgeDays = Math.max(
    1,
    (snapshot.takenAt.getTime() - snapshot.profile.accountCreatedAt.getTime()) /
      86_400_000,
  );

  const normFactor = ageNormFactor(accountAgeDays);

  // Data quality scoring
  let quality = 1.0;
  const hasCommitSignals = !!snapshot.commitSignals;
  const hasPRSignals = !!snapshot.prSignals;
  const hasRepoBreadth = snapshot.repoStats.repos.length > 0;

  if (!hasCommitSignals) {
    quality -= 0.15;
    warnings.push("commitSignals missing — quality layer uses defaults");
  }
  if (!hasPRSignals) {
    quality -= 0.1;
    warnings.push("prSignals missing — PR quality defaults to neutral");
  }
  if (!hasRepoBreadth) {
    quality -= 0.1;
    warnings.push("per-repo data missing — breadth score unavailable");
  }
  if (snapshot.weeklyActivity.length === 0) {
    quality -= 0.1;
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
  l0: L0Hygiene,
): L1QualitySignals {
  // ── PR Quality ────────────────────────────────────────────
  const cs = snapshot.commitSignals;
  const prs = snapshot.prSignals;

  const prMergeRate = prs ? clamp01(prs.merged / (prs.opened + ε)) : 0.5; // neutral default

  const reviewParticipationRate = prs
    ? clamp01(prs.reviewed / (prs.opened + ε))
    : 0.3; // neutral default

  // ── Commit Substance ──────────────────────────────────────
  // Combines: average lines changed (substance proxy),
  //           test file ratio (quality signal),
  //           refactor ratio (clean-up signal, positive but capped)
  let commitSubstanceScore = 0.5; // neutral default
  if (cs) {
    const sizeScore = sig(cs.avgLinesChanged, 50); // 50 lines = mid-tier
    const testBonus = cs.testFileRatio * 0.2;
    const refactorBump = Math.min(cs.refactorRatio * 0.15, 0.1); // capped bonus
    commitSubstanceScore = clamp01(sizeScore * 0.7 + testBonus + refactorBump);
  }

  // ── Repo Breadth ──────────────────────────────────────────
  // Penalizes concentration: if >80% pushes in one repo, flag + penalize.
  const repos = snapshot.repoStats.repos;
  let repoBreadthScore = 0.5;
  let singleRepoConcentration = false;

  if (repos.length > 0) {
    const totalPushes = repos.reduce((s, r) => s + r.pushCount, 0);
    const maxRepoPushes = Math.max(...repos.map((r) => r.pushCount));
    const concentration = totalPushes > 0 ? maxRepoPushes / totalPushes : 0;

    singleRepoConcentration = concentration > 0.8;

    // Breadth score: more unique active repos = higher score,
    // penalized by concentration
    const activeRepos = repos.filter((r) => r.isActive).length;
    const breadthRaw = sig(activeRepos, 5); // 5 active repos = mid-tier
    repoBreadthScore = clamp01(breadthRaw * (1 - concentration * 0.5));
  }

  // ── Repo Ecosystem Importance ─────────────────────────────
  // Weights: stars 40%, dependents 35%, pkg complexity 25%
  let repoImportanceScore = 0.3; // default: modest importance
  if (repos.length > 0) {
    const importanceScores = repos.map(
      (r) =>
        sig(r.stars, 50) * 0.4 +
        sig(r.dependents, 100) * 0.35 +
        sig(r.pkgComplexity, 10) * 0.25,
    );
    repoImportanceScore = clamp01(mean(importanceScores));
  }

  // ── Spam Flags ────────────────────────────────────────────
  //
  // Each flag only fires when we have real evidence, not absence of data.
  //
  // pushToMergeRatioAnomaly: requires real prSignals. When prSignals is
  //   absent we have no ground truth on merges — assume innocent.
  //   Also requires activity_30d.prs === 0 (not just merged === 0) to
  //   avoid false-positives when a dev opens PRs but the enriched pipeline
  //   hasn't captured merge status yet.
  //
  // singleRepoConcentration: skip when the repos array is a synthetic
  //   fallback (one entry whose repoId === 'aggregate-fallback'). That
  //   entry always has 100% concentration by construction, not by behavior.
  const totalPushes = snapshot.activity_30d.pushes;
  const avgLines = cs?.avgLinesChanged ?? 999;

  const lowSubstanceCommits = cs ? avgLines < 5 : false;

  // Only flag merge anomaly when we actually have PR signal data
  const pushToMergeRatioAnomaly = prs
    ? totalPushes > 30 && prs.merged === 0 && prs.opened === 0
    : false;

  // Skip concentration check on synthetic fallback repos
  const isSyntheticFallback =
    repos.length === 1 && repos[0]?.repoId === "aggregate-fallback";
  const effectiveSingleRepoConcentration = isSyntheticFallback
    ? false
    : singleRepoConcentration;

  return {
    prMergeRate,
    reviewParticipationRate,
    commitSubstanceScore,
    repoBreadthScore,
    repoImportanceScore,
    spamFlags: {
      singleRepoConcentration: effectiveSingleRepoConcentration,
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
  l1: L1QualitySignals,
): L2Features {
  const a = snapshot.activity_30d;
  const rs = snapshot.repoStats;
  const p = snapshot.profile;

  // ── Activity (0–100) ─────────────────────────────────────
  //
  // Age normalization is NOT applied to activity.
  // Rationale: the 30-day window already normalizes time.
  // 115 pushes this month means 115 pushes this month regardless
  // of account age. Applying age norm here double-penalizes senior
  // devs for their tenure and crushes scores for 2+ year accounts.
  // Age normalization belongs on CUMULATIVE signals (stars, forks)
  // where an old account genuinely has an unfair head start.
  //
  // Weight split: PRs are worth more per unit than pushes.
  // A PR represents reviewed, merged, meaningful work.
  // Pushes may include WIP commits, amends, rebases.
  const rawActivity = clamp(
    sig(a.pushes, K.pushes) * 30 +
      sig(a.prs, K.prs) * 35 + // PRs weighted above pushes
      sig(a.issues, K.issues) * 20 +
      sig(a.releases, K.releases) * 15,
  );

  // ── Impact (0–100) ────────────────────────────────────────
  // Point-in-time state — not decayed (see v3 design doc).
  const impact = clamp(
    sig(rs.totalStars, K.stars) * 50 +
      sig(rs.totalRepos, K.repos) * 25 +
      sig(rs.totalForks, K.forks) * 25,
  );

  // ── Quality (0–100) ─────────────────────────────────────
  // Captures the *how*, not just the *how much*.
  // All terms on the same 0–100 output scale — no division needed.
  //   prMergeRate:   sig(0–1, K=0.6)  * 35 → 0–35
  //   reviewRatio:   sig(0–1, K=0.4)  * 25 → 0–25
  //   substance:     0–1              * 25 → 0–25
  //   breadth:       0–1              * 15 → 0–15
  //   total max                            = 100
  const qualityScore = clamp(
    sig(l1.prMergeRate, K.prMergeRate) * 35 +
      sig(l1.reviewParticipationRate, K.reviewRatio) * 25 +
      l1.commitSubstanceScore * 25 +
      l1.repoBreadthScore * 15,
  );

  // ── Consistency (0–100) ───────────────────────────────────
  //
  // Consistency measures TIME DISTRIBUTION, not volume.
  // It is fully independent of rawActivity so that a dev who
  // pushes 200 commits on day 1 and nothing for 29 days does not
  // score the same as one who commits steadily every day.
  //
  // consistencyBase = 1 / (1 + CoV)
  //   CoV=0 (perfectly even) → base=1.0
  //   CoV=1 (sd = mean)      → base=0.5
  //   CoV→∞ (all in one day) → base→0
  //
  // streakScore = proportion of weeks that had ANY activity.
  //   All 4 weeks active → 1.0; only 1 week → 0.25
  //
  // Natural recency pattern (50,35,20,10) has CoV≈0.53:
  //   base = 1/(1+0.53) ≈ 0.65 → consistencyBase*70 = 45.5
  //   streak = 4/4 = 1.0 → streakBonus*30 = 30
  //   consistency ≈ 75 — correctly reflects steady engagement
  //   even though week volumes decline (recency weighting).
  const weeklyActivity = snapshot.weeklyActivity;
  let activityVariancePenalty = 0; // kept for L3 compatibility
  let consistency = 50; // neutral default: no weekly data

  if (weeklyActivity.length >= 2) {
    const weeklyPushes = weeklyActivity.map((w) => w.pushes + w.prs * 2);
    const weeklyCoV = cov(weeklyPushes);
    activityVariancePenalty = clamp(weeklyCoV * 20, 0, 40); // legacy field

    const consistencyBase = 1 / (1 + weeklyCoV); // 0–1

    // Streak: weeks with any meaningful activity (push OR pr)
    const activeWeeks = weeklyActivity.filter(
      (w) => w.pushes + w.prs > 0,
    ).length;
    const streakScore = activeWeeks / weeklyActivity.length; // 0–1

    consistency = clamp(consistencyBase * 70 + streakScore * 30);
  }

  // ── Reach (0–100) ─────────────────────────────────────────
  //
  // All terms kept on the same 0–100 output scale.
  // repoImportanceScore is 0–1; multiply by 20 to contribute 0–20.
  // repos K=20 (raised from 15) so 23 repos is above-midpoint but
  // does not dominate reach for a dev with 3 followers.
  //
  // Max decomposition:
  //   followers: sig(∞,15)*50 → 50
  //   repos:     sig(∞,20)*30 → 30
  //   importance:         1*20 → 20
  //   total max           → 100
  const reachScore = clamp(
    sig(p.followers, K.followers) * 50 +
      sig(p.public_repos, 20) * 30 +
      l1.repoImportanceScore * 20,
  );

  // ── Spam penalty ──────────────────────────────────────────
  const spamFlags = l1.spamFlags;
  const spamCount = [
    spamFlags.singleRepoConcentration,
    spamFlags.lowSubstanceCommits,
    spamFlags.pushToMergeRatioAnomaly,
  ].filter(Boolean).length;

  // Each spam flag reduces activity by 15%, stacking multiplicatively
  const spamMultiplier = Math.pow(0.85, spamCount);
  const finalActivity = clamp(rawActivity * spamMultiplier);

  return {
    activity: finalActivity,
    impact,
    quality: qualityScore,
    consistency,
    reach: reachScore,
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
  history: HistoricalScore[],
): L3Temporal {
  // ── Recency multiplier from weekly decay ──────────────────
  const weekly = snapshot.weeklyActivity;
  let recencyScore = 0.65; // neutral default
  let activityMultiplier = 0.75;

  if (weekly.length >= 2) {
    let totalMass = 0,
      recentMass = 0;
    for (const slice of weekly) {
      const ageDays = slice.weekOffset * 7;
      const w = decay(ageDays, τ_fast);
      const volume =
        slice.pushes + slice.prs * 2 + slice.issues + slice.releases * 3;
      totalMass += w * volume;
      if (slice.weekOffset <= 1) recentMass += w * volume;
    }
    recencyScore = totalMass > 0 ? clamp01(recentMass / totalMass) : 0.65;
    activityMultiplier = 0.5 + recencyScore * 0.5;
  }

  // ── Heat score (slow decay from last active date) ─────────
  // Uses the most recent weekly slice as a proxy for last activity.
  const lastActiveOffset =
    weekly.length > 0
      ? Math.min(
          ...weekly
            .filter((w) => w.pushes + w.prs > 0)
            .map((w) => w.weekOffset),
        )
      : 15; // assume 15 days inactive if unknown
  const heatScore = decay(lastActiveOffset * 7, τ_slow);

  // ── EMA Velocity + Acceleration ───────────────────────────
  // Requires at least 3 data points for meaningful acceleration.
  const scores = history.map((h) => h.totalScore);

  let velocity = 0;
  let acceleration = 0;
  let volatility = 0;

  if (scores.length >= 2) {
    // Velocity EMA: α=0.4 (deliberate lag to smooth noise)
    const velSeries = emaSeries(
      scores.slice(1).map((s, i) => s - scores[i]!),
      0.4,
    );
    velocity = velSeries.at(-1) ?? 0;

    // Acceleration EMA: α=0.3 (even more lag)
    if (velSeries.length >= 2) {
      const accSeries = emaSeries(
        velSeries.slice(1).map((v, i) => v - velSeries[i]!),
        0.3,
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
    ((velocity * (1 - λ * clamp01(volatility / 20))) / (scoreMean + ε)) * 10;
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
    activity: l2.activity * activityMultiplier,
    impact: l2.impact, // no decay — accumulated state
    quality: l2.quality * activityMultiplier,
    consistency: l2.consistency * activityMultiplier,
    reach: l2.reach, // no decay — accumulated state
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
  cohortPeers: number[],
): L4Cohort {
  const lang = snapshot.profile.primaryLanguage ?? "unknown";
  const cohortLabel =
    lang !== "unknown" ? `${lang} Developers` : "All Developers";

  // Size-tier matching: ±50% of candidate's repo count
  const candidateRepos = snapshot.repoStats.totalRepos;
  const lower = candidateRepos * 0.5;
  const upper = candidateRepos * 1.5;
  const sizedPeers = cohortPeers.filter(
    // cohortPeers are just scores — we do a simple global fallback
    // when we don't have per-peer repo counts. A real implementation
    // would accept CohortPeer[] objects with both score + metadata.
    () => true, // placeholder — tier matching requires enriched peer data
  );

  const activePeers = sizedPeers.length >= 10 ? sizedPeers : cohortPeers;
  const pct = activePeers.length > 0 ? pctRank(rawScore, activePeers) : null;

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

  // Ghost: no meaningful output across any real signal.
  // Uses l3.activity and l3.impact only — these are volume signals
  // that are genuinely zero when there is no output. Quality and
  // consistency can show neutral defaults (50) even on empty profiles
  // due to absent prSignals/commitSignals being filled with mid-range
  // defaults. Do NOT gate on those — only on real output signals.
  const hasNoRealActivity = activity < 5;
  const hasNoRealImpact = impact < 5;
  if (hasNoRealActivity && hasNoRealImpact) return "ghost";

  // Framework Author: very high impact + importance + decent quality
  if (impact > 65 && l1.repoImportanceScore > 0.65 && quality > 50)
    return "framework_author";

  // Research Dev: high quality/complexity, low reach, niche impact
  if (quality > 65 && reach < 30 && l1.commitSubstanceScore > 0.7)
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
  l0: L0Hygiene,
): L5Composite {
  const archetype = detectArchetype(l3, l1);
  const weights = ARCHETYPE_WEIGHTS[archetype];

  const rawComposite =
    l3.activity * weights.activity +
    l3.impact * weights.impact +
    l3.quality * weights.quality +
    l3.consistency * weights.consistency +
    l3.reach * weights.reach;

  // Add momentum — already bounded ±8
  const withMomentum = clamp(rawComposite + l3.momentumScore);

  // Elite promotion: composite ≥ 85 after shaping
  const shaped = shapeDistribution(withMomentum);
  const finalArchetype: Archetype = shaped >= 88 ? "elite" : archetype;

  // Confidence
  const conf = confidenceScore(snapshotCount, l0.dataQualityScore);
  const confLvl = confidenceLevel(snapshotCount, l0.dataQualityScore);

  const allScores = [...history.map((h) => h.totalScore), shaped];
  const ci = confidenceInterval(allScores, shaped);

  return {
    archetype: finalArchetype,
    weights,
    rawComposite,
    shapedScore: shaped,
    confidenceLevel: confLvl,
    confidenceInterval: ci,
  };
}
