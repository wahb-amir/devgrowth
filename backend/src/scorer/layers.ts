// ============================================================
// layers.ts — The 7 scoring layers, each a pure function
// ============================================================

import {
  sigmoid,
  decayWeight,
  mean,
  stdDev,
  ema,
  lsSlope,
  clamp,
  percentileRankIn,
} from "./math.js";

import type {
  RawSnapshot,
  HistoricalScore,
  WeeklyActivity,
  Layer1Output,
  Layer2Output,
  Layer3Output,
  Layer4Output,
  Layer5Output,
  Layer6Output,
  Layer7Output,
  DevArchetype,
} from "../jobs/score/types.js";

// ─── Tiny epsilon to prevent divide-by-zero ───────────────────
const ε = 1e-6;

// ─────────────────────────────────────────────────────────────
// LAYER 1 — Sigmoid Normalisation
//
// Maps raw counts → (0, 1) with signal-specific calibration.
// Calibration table:
//   mu  = "typical mid-tier" value (maps to 0.5)
//   k   = steepness (higher → sharper step)
//
// Anti-gaming note:
//   Pushes use a LOW k (0.12) so spamming 500 pushes
//   yields a barely higher score than 60 pushes.
//   PRs use higher k because each PR requires meaningful effort.
// ─────────────────────────────────────────────────────────────
export function computeLayer1(snapshot: RawSnapshot): Layer1Output {
  const a = snapshot.activity_30d;
  const repo = snapshot.repoStats;
  const profile = snapshot.profile;

  return {
    // Activity signals — aggressive compression on pushes to deter spam
    pushes: sigmoid(a.pushes, 0.12, 20),
    prs: sigmoid(a.prs, 0.30, 8),
    issues: sigmoid(a.issues, 0.20, 10),
    releases: sigmoid(a.releases, 0.70, 3),

    // Impact signals — log-scale inputs fed into sigmoid
    stars: sigmoid(Math.log10(repo.totalStars + 1), 1.8, 2.5),
    forks: sigmoid(Math.log10(repo.totalForks + 1), 2.2, 1.8),

    // Reach signals
    followers: sigmoid(Math.log10(profile.followers + 1), 1.5, 2.0),
    repos: sigmoid(Math.log10(profile.public_repos + 1), 2.0, 1.5),
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — Behavioural Signals
//
// Derives higher-order signals from Layer 1 values.
//
// Anti-gaming:
//   ProductivityRatio: 500 pushes with 0 PRs → ratio → 0 (very bad).
//   ImpactEfficiency:  many repos with 0 stars → score → 0.
//   BurstScore:        triggers penalty when activity is
//                      concentrated in a single spike.
// ─────────────────────────────────────────────────────────────
export function computeLayer2(
  l1: Layer1Output,
  weekly: WeeklyActivity[] = []
): Layer2Output {
  // Productivity Ratio: PR density relative to push volume
  // High pushes with few PRs → score approaches 0
  const productivityRatio = clamp(l1.prs / (l1.pushes + ε));

  // Impact Efficiency: star×fork density relative to repo count
  // Owning 300 repos with 10 total stars → score → 0
  const impactEfficiency = clamp(
    (l1.stars * l1.forks) / (l1.repos + ε)
  );

  // Consistency Variance: based on per-week push distribution
  // Perfect consistency → score = 1; all activity in one day → score → 0
  let consistencyVariance = 0.5; // neutral default when no weekly data
  let burstScore = 0;

  if (weekly.length >= 2) {
    const weeklyPushes = weekly.map((w) => w.pushes);
    const m = mean(weeklyPushes);
    const sd = stdDev(weeklyPushes);

    // CoV-based consistency: 1/(1+CoV) so it never goes negative.
    // Consistent dev (CoV ≈ 0.05) → ≈ 0.95; bursty (CoV ≈ 47) → ≈ 0.02
    const coefficientOfVariation = sd / (m + ε);
    consistencyVariance = clamp(1 / (1 + coefficientOfVariation));

    // Burst Score: peak-week z-score /10 so 10σ = 1.0.
    // Real spammers hit 30–50σ → clamp to 1.0.
    // Even distribution → z ≈ 0 → burstScore ≈ 0.
    const maxPush = Math.max(...weeklyPushes);
    const rawBurst = (maxPush - m) / (sd + ε);
    burstScore = clamp(rawBurst / 10);
  }

  return { productivityRatio, impactEfficiency, consistencyVariance, burstScore };
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — Temporal Decay
//
// Weights each week's activity by how recent it is.
// w(t) = e^(-t / halfLife * ln2)
//   t          = age in days (weekOffset * 7 for weekly data)
//   halfLifeDays = 10 → activity 10 days ago counts 50%
//
// Anti-gaming: a 1-day commit spike followed by 29 days of
// silence decays to near-zero by scoring time.
// ─────────────────────────────────────────────────────────────
export function computeLayer3(
  snapshot: RawSnapshot,
  halfLifeDays = 10
): Layer3Output {
  const weekly = snapshot.weeklyActivity;

  // ── No weekly data: fall back to 30-day aggregate with a
  //    bulk decay anchored at the midpoint age (15 days).
  if (!weekly || weekly.length === 0) {
    const bulkDecay = decayWeight(15, halfLifeDays);
    const a = snapshot.activity_30d;
    return {
      decayedPushes: a.pushes * bulkDecay,
      decayedPRs: a.prs * bulkDecay,
      decayedIssues: a.issues * bulkDecay,
      decayedReleases: a.releases * bulkDecay,
      recencyBias: 0.5, // unknown — neutral
    };
  }

  // ── Weekly granularity: apply per-week decay ──────────────
  let wPushes = 0,
    wPRs = 0,
    wIssues = 0,
    wReleases = 0,
    wTotal = 0;

  for (const week of weekly) {
    const ageDays = week.weekOffset * 7;
    const w = decayWeight(ageDays, halfLifeDays);

    wPushes += week.pushes * w;
    wPRs += week.prs * w;
    wIssues += week.issues * w;
    wReleases += week.releases * w;
    wTotal += w;
  }

  // Recency bias: proportion of weight-mass in the last 2 weeks
  const recentWeight = weekly
    .filter((w) => w.weekOffset <= 2)
    .reduce((s, w) => s + decayWeight(w.weekOffset * 7, halfLifeDays), 0);
  const recencyBias = wTotal > 0 ? clamp(recentWeight / wTotal) : 0.5;

  return {
    decayedPushes: wPushes,
    decayedPRs: wPRs,
    decayedIssues: wIssues,
    decayedReleases: wReleases,
    recencyBias,
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 4 — Cohort / Percentile Normalisation
//
// Compares a developer's raw composite against a peer cohort.
// Cohort is selected by repo-size tier to avoid penalising
// library authors for not having viral projects.
// ─────────────────────────────────────────────────────────────
export type CohortPeer = { totalScore: number; repoCount: number };

export function computeLayer4(
  candidateScore: number,
  candidateRepoCount: number,
  cohort: CohortPeer[]
): Layer4Output {
  if (cohort.length === 0) {
    return { percentileRank: null, cohortSize: 0, cohortLabel: "unknown" };
  }

  // Select peers within ±50% repo count (same "size tier")
  const lower = candidateRepoCount * 0.5;
  const upper = candidateRepoCount * 1.5;
  const peers = cohort.filter(
    (p) => p.repoCount >= lower && p.repoCount <= upper
  );
  const activePeers = peers.length >= 10 ? peers : cohort; // fallback to full cohort

  const peerScores = activePeers.map((p) => p.totalScore);
  const pct = percentileRankIn(candidateScore, peerScores);

  const label =
    peers.length >= 10
      ? `size-matched (n=${peers.length})`
      : `global (n=${cohort.length})`;

  return {
    percentileRank: Math.round(pct * 10) / 10,
    cohortSize: activePeers.length,
    cohortLabel: label,
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 5 — Adaptive Composite Scoring
//
// 5a. Detect developer archetype from L1/L2/L3 signals.
// 5b. Select archetype-specific weight vector.
// 5c. Compute weighted composite in [0, 100].
//
// Anti-gaming: burstScore ≥ 0.8 triggers a "spam penalty"
// that hard-caps the activity component contribution.
// ─────────────────────────────────────────────────────────────

type Weights = Layer5Output["weights"];

const WEIGHT_PRESETS: Record<DevArchetype, Weights> = {
  maintainer: {
    activity: 0.20, impact: 0.25, consistency: 0.35,
    reach: 0.10, behavioral: 0.10,
  },
  builder: {
    activity: 0.40, impact: 0.20, consistency: 0.20,
    reach: 0.10, behavioral: 0.10,
  },
  impact_dev: {
    activity: 0.15, impact: 0.45, consistency: 0.15,
    reach: 0.15, behavioral: 0.10,
  },
  rising_dev: {
    activity: 0.30, impact: 0.25, consistency: 0.20,
    reach: 0.10, behavioral: 0.15,
  },
  balanced: {
    activity: 0.25, impact: 0.30, consistency: 0.20,
    reach: 0.15, behavioral: 0.10,
  },
  watch_area: {
    activity: 0.25, impact: 0.25, consistency: 0.25,
    reach: 0.15, behavioral: 0.10,
  },
};

function detectArchetype(
  l1: Layer1Output,
  l2: Layer2Output,
  l3: Layer3Output
): DevArchetype {
  // Compound activity: push-volume counts less than PRs/issues/releases.
  // This means a pure push-spammer scores activity < 0.30 even with
  // sigmoid-saturated l1.pushes, because prs and releases remain near 0.
  const activity =
    (l1.pushes * 0.5 + l1.prs * 2.0 + l1.issues * 1.0 + l1.releases * 2.5) / 6.0;
  const impact = l1.stars * 0.6 + l1.forks * 0.4;
  const reach = l1.followers * 0.6 + l1.repos * 0.4;

  const isHighActivity = activity >= 0.55;
  const isHighImpact = impact >= 0.55;
  const isConsistent = l2.consistencyVariance >= 0.65 && l3.recencyBias >= 0.4;
  const isGrowing = l3.recencyBias >= 0.6;

  // Spam pattern: high raw pushes but negligible PR quality
  // productivityRatio < 0.15 means nearly no meaningful PRs despite high commit volume
  const isSpamPattern =
    l1.pushes > 0.8 && l2.productivityRatio < 0.15 && impact < 0.30;

  if (isSpamPattern)
    return "watch_area";
  if (isHighActivity && !isHighImpact && l2.productivityRatio < 0.5)
    return "builder";
  if (isHighImpact && !isHighActivity)
    return "impact_dev";
  if (isConsistent && isHighActivity && impact >= 0.35)
    return "maintainer";
  if (isGrowing && (activity >= 0.45 || impact >= 0.45 || reach >= 0.45))
    return "rising_dev";

  const isLowEverything =
    activity < 0.30 && impact < 0.30 && l2.consistencyVariance < 0.35;
  if (isLowEverything)
    return "watch_area";

  return "balanced";
}

export function computeLayer5(
  l1: Layer1Output,
  l2: Layer2Output,
  l3: Layer3Output
): Layer5Output {
  const archetype = detectArchetype(l1, l2, l3);
  const weights = WEIGHT_PRESETS[archetype];

  // Sub-scores (0–1)
  const activityRaw =
    (sigmoid(l3.decayedPushes, 0.08, 20) +
      sigmoid(l3.decayedPRs, 0.25, 6) * 1.5 +
      sigmoid(l3.decayedIssues, 0.18, 8) +
      sigmoid(l3.decayedReleases, 0.60, 2) * 2) /
    6;

  // Spam penalty: a burst without corresponding PR quality gets capped
  const spamPenalty = l2.burstScore >= 0.8 ? 0.55 : 1.0;
  const activityScore = activityRaw * spamPenalty;

  const impactScore = l1.stars * 0.55 + l1.forks * 0.45;
  const consistencyScore =
    l2.consistencyVariance * 0.6 + (1 - l2.burstScore) * 0.4;
  const reachScore = l1.followers * 0.55 + l1.repos * 0.45;
  const behavioralScore =
    l2.productivityRatio * 0.5 + l2.impactEfficiency * 0.5;

  const composite =
    activityScore * weights.activity +
    impactScore * weights.impact +
    consistencyScore * weights.consistency +
    reachScore * weights.reach +
    behavioralScore * weights.behavioral;

  return {
    archetype,
    weights,
    compositeScore: clamp(composite * 100, 0, 100),
  };
}

// ─────────────────────────────────────────────────────────────
// LAYER 6 — Trend Engine
//
// Uses EMA + OLS slope over historical totalScores to classify
// momentum and compute a bounded trend bonus.
//
// Prevents false positives: a single good snapshot is not
// "accelerating"; we require at least 3 data points.
// ─────────────────────────────────────────────────────────────
export function computeLayer6(history: HistoricalScore[]): Layer6Output {
  if (history.length < 2) {
    return {
      ema: history.map((h) => h.totalScore),
      slope: 0,
      momentum: "stable",
      trendBonus: 0,
    };
  }

  // Sort chronologically
  const sorted = [...history].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime()
  );
  const scores = sorted.map((h) => h.totalScore);

  const emaSeries = ema(scores, Math.min(scores.length, 5));
  const slope = lsSlope(emaSeries);

  // Slope thresholds relative to score scale (0–100)
  let momentum: Layer6Output["momentum"];
  if (slope > 1.5) momentum = "accelerating";
  else if (slope < -1.5) momentum = "decelerating";
  else momentum = "stable";

  // Trend bonus: ±5 points max, proportional to slope
  const trendBonus = clamp(slope * 0.8, -5, 5);

  return { ema: emaSeries, slope, momentum, trendBonus };
}

// ─────────────────────────────────────────────────────────────
// LAYER 7 — Confidence Layer
//
// Produces a trust multiplier based on:
//   - Number of historical snapshots (more = more reliable)
//   - Data quality (penalises missing weeklyActivity, etc.)
//
// A developer with 1 snapshot gets confidence ≈ 0.35.
// A developer with 12+ snapshots gets confidence ≈ 0.95.
// This prevents viral newcomers from being over-ranked.
// ─────────────────────────────────────────────────────────────
export function computeLayer7(
  snapshotCount: number,
  snapshot: RawSnapshot
): Layer7Output {
  // Snapshot confidence via sigmoid (midpoint = 10 snapshots)
  const snapshotConfidence = sigmoid(snapshotCount, 0.35, 8);

  // Data quality penalties
  let quality = 1.0;
  if (!snapshot.weeklyActivity || snapshot.weeklyActivity.length === 0)
    quality -= 0.15; // missing granular data
  if (snapshot.repoStats.totalRepos === 0)
    quality -= 0.10; // no repos at all
  if (snapshot.profile.followers === 0 && snapshot.profile.public_repos === 0)
    quality -= 0.20; // profile effectively empty

  const dataQuality = clamp(quality);
  const trustScore = clamp(snapshotConfidence * dataQuality);

  return { snapshotConfidence, dataQuality, trustScore };
}