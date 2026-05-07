// ============================================================
// types.ts — Shared type contracts for the 7-Layer Scorer
// ============================================================

export type DevArchetype =
  | "maintainer"
  | "builder"
  | "impact_dev"
  | "rising_dev"
  | "balanced"
  | "watch_area";

// ── Raw input shape (what arrives from the snapshot pipeline) ──

export interface WeeklyActivity {
  weekOffset: number; // 0 = current week, 1 = last week, …
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
  daysSinceEpoch?: number; // for precise decay; derived if absent
}

export interface RawSnapshot {
  takenAt: Date;
  profile: {
    followers: number;
    public_repos: number;
  };
  repoStats: {
    totalStars: number;
    totalForks: number;
    totalRepos: number;
  };
  /** 30-day aggregate kept for backward-compat; superseded by weeklyActivity */
  activity_30d: {
    pushes: number;
    prs: number;
    issues: number;
    releases: number;
  };
  /** Optional per-week breakdown; enables Layers 2, 3, 6 */
  weeklyActivity?: WeeklyActivity[];
}

export interface HistoricalScore {
  takenAt: Date;
  totalScore: number;
}

// ── Per-layer outputs ──

export interface Layer1Output {
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
  stars: number;
  forks: number;
  followers: number;
  repos: number;
}

export interface Layer2Output {
  productivityRatio: number;
  impactEfficiency: number;
  consistencyVariance: number;
  burstScore: number;
}

export interface Layer3Output {
  decayedPushes: number;
  decayedPRs: number;
  decayedIssues: number;
  decayedReleases: number;
  recencyBias: number; // 0–1, how recent the bulk of activity is
}

export interface Layer4Output {
  percentileRank: number | null; // null when cohort is unavailable
  cohortSize: number;
  cohortLabel: string;
}

export interface Layer5Output {
  archetype: DevArchetype;
  weights: {
    activity: number;
    impact: number;
    consistency: number;
    reach: number;
    behavioral: number;
  };
  compositeScore: number; // 0–100
}

export interface Layer6Output {
  ema: number[]; // EMA series over historical scores
  slope: number; // trend direction (+ = growing)
  momentum: "accelerating" | "stable" | "decelerating";
  trendBonus: number; // additive adjustment, ± capped
}

export interface Layer7Output {
  snapshotConfidence: number; // 0–1
  dataQuality: number; // 0–1 (penalises missing weeklyActivity, etc.)
  trustScore: number; // combined 0–1
}

// ── Final envelope ──

export interface ScoringResult {
  finalScore: number; // 0–100, confidence-adjusted
  rawCompositeScore: number; // pre-confidence
  archetype: DevArchetype;
  percentileRank: number | null;
  confidence: number;
  growthScore: number;
  momentum: Layer6Output["momentum"];
  layers: {
    l1: Layer1Output;
    l2: Layer2Output;
    l3: Layer3Output;
    l4: Layer4Output;
    l5: Layer5Output;
    l6: Layer6Output;
    l7: Layer7Output;
  };
  meta: {
    scorerVersion: string;
    computedAt: Date;
    warnings: string[];
  };
}