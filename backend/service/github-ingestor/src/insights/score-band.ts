// src/insights/score-band.ts

/**
 * Score band classifier.
 *
 * The band is the single source of truth for what kinds of narrative
 * language, archetype labels, and trajectory claims the engine is
 * allowed to produce. Every text-generating function that could
 * overstate a weak profile receives the band as a parameter.
 *
 * Thresholds are based on the scoring system's 0–100 range:
 *   low     →  0 – 29   early-stage / limited-signal profile
 *   average → 30 – 54   developing profile with mixed signals
 *   strong  → 55 – 74   established profile with clear strengths
 *   elite   → 75 – 100  top-tier profile with dominant signals
 */

export type ScoreBand = "low" | "average" | "strong" | "elite";

export function classifyScoreBand(totalScore: number): ScoreBand {
  if (totalScore < 30) return "low";
  if (totalScore < 55) return "average";
  if (totalScore < 75) return "strong";
  return "elite";
}

/**
 * Words and phrases that are prohibited for a given score band.
 * Kept as a reference; the engine uses `isLanguageAllowed` rather
 * than scanning generated strings — all restricted language is
 * simply never emitted for those bands.
 */
export const BANNED_PHRASES_BY_BAND: Record<ScoreBand, string[]> = {
  low: [
    "accelerating",
    "strong momentum",
    "compounding growth",
    "breakout",
    "headroom to grow",
    "clear strength",
    "standout signal",
    "well above typical",
    "dominant signal",
    "top-tier",
    "elite",
    "notable strength",
  ],
  average: [
    "compounding growth",
    "breakout",
    "dominant signal",
    "top-tier",
    "elite",
  ],
  strong: [],
  elite: [],
};

/**
 * Whether a given narrative capability is allowed for a score band.
 * Use this to gate entire card types or text branches.
 */
export function isAllowed(
  band: ScoreBand,
  capability:
    | "positive_trajectory" // upward trajectory language
    | "rich_archetype" // maintainer, ecosystem builder, etc.
    | "growth_language" // "accelerating", "compounding", "headroom"
    | "strong_strength_claim" // "standout", "dominant", "well above typical"
    | "confident_trend_claim", // "will", "points upward", "momentum holds"
): boolean {
  switch (capability) {
    case "positive_trajectory":
      return band === "strong" || band === "elite";
    case "rich_archetype":
      return band === "strong" || band === "elite";
    case "growth_language":
      return band === "strong" || band === "elite";
    case "strong_strength_claim":
      return band !== "low";
    case "confident_trend_claim":
      return band === "strong" || band === "elite";
  }
}

/**
 * Returns a restrained archetype label for low/average bands.
 * Higher bands use the full archetype title from the archetype engine.
 */
export function getConstrainedArchetypeTitle(
  band: ScoreBand,
  fullTitle: string,
  activityScore: number,
  impactScore: number,
  consistencyScore: number,
): string {
  if (band === "strong" || band === "elite") return fullTitle;

  if (band === "low") {
    // Pick the least overstating label based on which signal is least weak
    if (activityScore >= 45) return "Active but limited-impact contributor";
    if (consistencyScore >= 40) return "Early-stage consistent contributor";
    return "Emerging contributor with limited signal";
  }

  // average band — slightly restrained but not minimal
  if (activityScore >= 50 && impactScore < 35) return "Rising contributor";
  if (consistencyScore >= 50) return "Developing consistent contributor";
  return "Developing contributor";
}
