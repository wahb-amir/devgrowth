// ============================================================
// scorer.ts — Orchestrates the 7-layer pipeline
// ============================================================

import {
  computeLayer1,
  computeLayer2,
  computeLayer3,
  computeLayer4,
  computeLayer5,
  computeLayer6,
  computeLayer7,
  type CohortPeer,
} from "./layers.js";

import { clamp } from "./math.js";

import type {
  RawSnapshot,
  HistoricalScore,
  ScoringResult,
} from "./types.js";

export const SCORER_VERSION = "v2.0.0";

export interface ScorerOptions {
  /**
   * Peers used for Layer 4 percentile ranking.
   * Supply an empty array to skip percentile computation.
   */
  cohort?: CohortPeer[];

  /**
   * Historical scored snapshots for the same developer.
   * Required for Layers 6 (trend) and 7 (confidence).
   * The most recent snapshot should NOT be included here —
   * only the snapshots that precede the current scoring run.
   */
  history?: HistoricalScore[];

  /**
   * Half-life in days for temporal decay (Layer 3).
   * Defaults to 10 days.
   */
  decayHalfLifeDays?: number;
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────
export function scoreSnapshot(
  snapshot: RawSnapshot,
  options: ScorerOptions = {}
): ScoringResult {
  const {
    cohort = [],
    history = [],
    decayHalfLifeDays = 10,
  } = options;

  const warnings: string[] = [];
  const computedAt = new Date();

  // ── L1: Normalise raw signals to (0, 1) ───────────────────
  const l1 = computeLayer1(snapshot);

  // ── L2: Derive behavioural signals ────────────────────────
  const l2 = computeLayer2(l1, snapshot.weeklyActivity);
  if (!snapshot.weeklyActivity?.length) {
    warnings.push(
      "weeklyActivity missing — L2 consistency/burst signals use neutral defaults"
    );
  }

  // ── L3: Apply temporal decay ──────────────────────────────
  const l3 = computeLayer3(snapshot, decayHalfLifeDays);

  // ── L5: Archetype detection + adaptive composite ──────────
  // (L5 before L4 because L4 needs the composite score)
  const l5 = computeLayer5(l1, l2, l3);

  // ── L4: Cohort percentile ─────────────────────────────────
  const l4 = computeLayer4(
    l5.compositeScore,
    snapshot.repoStats.totalRepos,
    cohort
  );
  if (cohort.length === 0) {
    warnings.push("No cohort supplied — percentileRank will be null");
  }

  // ── L6: Trend engine ─────────────────────────────────────
  const l6 = computeLayer6(history);
  if (history.length < 3) {
    warnings.push(
      `Only ${history.length} historical snapshot(s) — trend signal is weak`
    );
  }

  // ── L7: Confidence layer ──────────────────────────────────
  const snapshotCount = history.length + 1; // include current
  const l7 = computeLayer7(snapshotCount, snapshot);

  // ── Final score composition ───────────────────────────────
  //
  // rawCompositeScore = L5 composite + L6 trend bonus
  // finalScore        = rawComposite × L7 trustScore
  //
  // Why multiply by trust, not add?
  // Multiplication prevents a high-data newcomer from gaming the
  // confidence layer additively. A dev with 1 snapshot scores at
  // most ~35% of what their signals would otherwise imply.

  const rawCompositeScore = clamp(
    l5.compositeScore + l6.trendBonus,
    0,
    100
  );

  // Blend: trust pulls score toward 50 (neutral) when low
  const neutralAnchor = 50;
  const finalScore = clamp(
    rawCompositeScore * l7.trustScore +
      neutralAnchor * (1 - l7.trustScore),
    0,
    100
  );

  // Growth score: last known score delta, or 0
  const growthScore =
    history.length >= 1
      ? clamp(
          rawCompositeScore -
            history[history.length - 1]!.totalScore,
          -100,
          100
        )
      : 0;

  return {
    finalScore: Math.round(finalScore * 100) / 100,
    rawCompositeScore: Math.round(rawCompositeScore * 100) / 100,
    archetype: l5.archetype,
    percentileRank: l4.percentileRank,
    confidence: Math.round(l7.trustScore * 1000) / 1000,
    growthScore: Math.round(growthScore * 100) / 100,
    momentum: l6.momentum,
    layers: { l1, l2, l3, l4, l5, l6, l7 },
    meta: {
      scorerVersion: SCORER_VERSION,
      computedAt,
      warnings,
    },
  };
}