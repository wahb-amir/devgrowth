// =============================================================
// types.ts — Complete V3 type contracts
// =============================================================

// ── Archetypes ────────────────────────────────────────────────

export type Archetype =
  | "elite"
  | "framework_author" // high stars, high dependents, moderate activity
  | "infra_engineer" // low public stars but high org-level impact
  | "research_dev" // niche high-complexity repos, low social reach
  | "maintainer" // consistent, broad contributions, review-heavy
  | "builder" // high activity, ships frequently, lower review ratio
  | "impact_dev" // large accumulated reputation, lower recent activity
  | "rising_dev" // strong positive acceleration, still building reach
  | "balanced"
  | "ghost"; // all signals near zero

export type MomentumLabel =
  | "accelerating"
  | "stable"
  | "decelerating"
  | "volatile"; // high acceleration + high volatility

export type ConfidenceLevel =
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "very_high";

export type TensionType =
  | "high_activity_declining_impact" // busy but less relevant
  | "high_impact_declining_activity" // coasting on reputation
  | "rising_reach_no_output" // followers growing, no commits
  | "quality_activity_divergence" // more commits, lower PR quality
  | "consistency_burst_conflict" // normally consistent, sudden spike
  | "none";

// ── Raw input ─────────────────────────────────────────────────

export interface CommitSignals {
  totalCommits: number;
  avgLinesChanged: number; // proxy for commit size/substance
  refactorRatio: number; // 0–1, proportion that are refactors (deletions-heavy)
  testFileRatio: number; // 0–1, proportion touching test files
}

export interface PRSignals {
  opened: number;
  merged: number;
  reviewed: number; // PRs reviewed (not authored) — collaboration signal
  avgTimeToMergeHours: number;
}

export interface RepoSignal {
  repoId: string;
  stars: number;
  forks: number;
  dependents: number; // downstream packages depending on this repo
  pkgComplexity: number; // 0–20, derived from dependency count in package.json
  isActive: boolean; // had a commit in the last 90 days
  primaryLanguage: string;
  pushCount: number; // pushes to THIS repo in the window
}

export interface Activity30d {
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
}

export interface WeeklySlice {
  weekOffset: number; // 0 = current week
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
}

export interface RawProfile {
  followers: number;
  public_repos: number;
  accountCreatedAt: Date; // for age normalization
  primaryLanguage?: string; // dominant language for cohort assignment
}

export interface EnrichedSnapshot {
  takenAt: Date;
  profile: RawProfile;
  repoStats: {
    totalStars: number;
    totalForks: number;
    totalRepos: number;
    repos: RepoSignal[]; // per-repo breakdown for breadth scoring
  };
  activity_30d: Activity30d;
  weeklyActivity: WeeklySlice[];
  commitSignals?: CommitSignals;
  prSignals?: PRSignals;
}

export interface HistoricalScore {
  takenAt: Date;
  totalScore: number;
  subScores?: {
    activity: number;
    impact: number;
    quality: number;
    consistency: number;
    reach: number;
  };
}

export interface V3Input {
  snapshot: EnrichedSnapshot;
  history: HistoricalScore[]; // oldest first
  cohortPeers?: number[]; // peer totalScores for percentile calc
  snapshotCount?: number;
}

// ── Layer outputs ──────────────────────────────────────────────

export interface L0Hygiene {
  accountAgeDays: number;
  ageNormFactor: number; // sub-linear compression factor
  dataQualityScore: number; // 0–1
  hasCommitSignals: boolean;
  hasPRSignals: boolean;
  hasRepoBreadth: boolean;
  warnings: string[];
}

export interface L1QualitySignals {
  prMergeRate: number; // 0–1
  reviewParticipationRate: number; // reviews / (prs opened)
  commitSubstanceScore: number; // 0–1, based on avg size + test/refactor ratio
  repoBreadthScore: number; // 0–1, diversity of contributions
  repoImportanceScore: number; // 0–1, weighted ecosystem importance
  spamFlags: {
    singleRepoConcentration: boolean; // >80% pushes in one repo
    lowSubstanceCommits: boolean; // avg lines changed < 5
    pushToMergeRatioAnomaly: boolean; // very high pushes, near-zero PR merges
  };
}

export interface L2Features {
  activity: number; // 0–100
  impact: number; // 0–100
  quality: number; // 0–100, new layer vs v2
  consistency: number; // 0–100
  reach: number; // 0–100
  // internals
  activityVariancePenalty: number;
  spamPenaltyApplied: boolean;
}

export interface L3Temporal {
  activity: number;
  impact: number;
  quality: number;
  consistency: number;
  reach: number;
  recencyScore: number; // 0–1
  heatScore: number; // 0–1, slow-decay "still active?"
  velocity: number; // EMA of score delta
  acceleration: number; // EMA of velocity delta
  volatility: number; // stddev of score series
  momentumScore: number; // ±8 bounded adjustment
  momentumLabel: MomentumLabel;
}

export interface L4Cohort {
  cohortLabel: string; // e.g. "TypeScript Developers"
  percentileRank: number | null;
  cohortSize: number;
  legacyCorrectionApplied: boolean;
}

export interface L5Composite {
  archetype: Archetype;
  weights: Record<string, number>;
  rawComposite: number;
  shapedScore: number; // post distribution shaping
  confidenceLevel: ConfidenceLevel;
  confidenceInterval: [number, number]; // [lower, upper] 95% CI
}

export interface L6Narrative {
  headline: string; // one-line summary
  tension: TensionType;
  tensionDescription: string | null;
  strengths: string[];
  watchAreas: string[];
  trajectoryStatement: string;
  confidenceStatement: string;
}

// ── Final output ───────────────────────────────────────────────

export interface V3Output {
  finalScore: number;
  archetype: Archetype;
  percentileRank: number | null;
  confidence: number; // 0–1
  confidenceLevel: ConfidenceLevel;
  confidenceInterval: [number, number];
  momentum: MomentumLabel;
  trend: number;
  subScores: {
    activity: number;
    impact: number;
    quality: number;
    consistency: number;
    reach: number;
  };
  antiExploit: {
    spamFlagged: boolean;
    singleRepoConcentration: boolean;
    lowSubstanceCommits: boolean;
    pushToPrMergeAnomaly: boolean;
  };
  narrative: L6Narrative;
  layers: {
    l0: L0Hygiene;
    l1: L1QualitySignals;
    l2: L2Features;
    l3: L3Temporal;
    l4: L4Cohort;
    l5: L5Composite;
  };
  meta: {
    scorerVersion: string;
    computedAt: Date;
    warnings: string[];
  };
}

export interface NormalizedProfile {
  followers: number;
  repos: number;
  stars: number;
  forks: number;
  activity_30d: Activity30d;
  weeklyActivity?: WeeklySlice[];
}

export interface HistoricalEntry {
  takenAt: Date;
  totalScore: number;
}
