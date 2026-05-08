// =============================================================
// types.ts — V3 type contracts
// =============================================================

export type Archetype =
  | "elite"
  | "impact_dev"
  | "maintainer"
  | "builder"
  | "rising_dev"
  | "balanced"
  | "ghost"; // low signal across all dimensions

// ── Input ─────────────────────────────────────────────────────

export interface Activity30d {
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
}

/** Weekly snapshot for temporal granularity */
export interface WeeklySlice {
  weekOffset: number; // 0 = current, 1 = last week, …
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
}

/** Shape of normalizedProfile already persisted in DB */
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

export interface V3Input {
  profile: NormalizedProfile;
  history?: HistoricalEntry[]; // previous scored snapshots, oldest first
  snapshotCount?: number;      // total snapshots ever taken (for confidence)
}

// ── Layer outputs ──────────────────────────────────────────────

export interface L1Signals {
  pushes: number;
  prs: number;
  issues: number;
  releases: number;
  stars: number;
  repos: number;
  forks: number;
  followers: number;
}

export interface L2Features {
  activity: number;       // 0–100
  impact: number;         // 0–100
  consistency: number;    // 0–100
  reach: number;          // 0–100
  // diagnostic
  activityVariancePenalty: number;
  pushToPrRatio: number;
  burstRatio: number;
  spamPenaltyApplied: boolean;
}

export interface L3Decayed {
  activity: number;
  impact: number;
  consistency: number;
  reach: number;
  recencyScore: number; // 0–1, how recent bulk activity is
}

export interface L4Result {
  rawComposite: number;      // pre-shape weighted sum
  finalScore: number;        // post-shape 0–100
  archetype: Archetype;
  confidence: number;        // 0–1
  trend: number;             // EMA-based delta
  trendLabel: "accelerating" | "stable" | "decelerating";
}

// ── Final output ───────────────────────────────────────────────

export interface V3Output {
  finalScore: number;
  archetype: Archetype;
  confidence: number;
  trend: number;
  trendLabel: L4Result["trendLabel"];
  subScores: {
    activity: number;
    impact: number;
    consistency: number;
    reach: number;
  };
  antiExploit: {
    spamFlagged: boolean;
    burstFlagged: boolean;
    pushToPrRatio: number;
    burstRatio: number;
  };
  layers: {
    l1: L1Signals;
    l2: L2Features;
    l3: L3Decayed;
    l4: L4Result;
  };
  meta: {
    scorerVersion: string;
    computedAt: Date;
    warnings: string[];
  };
}