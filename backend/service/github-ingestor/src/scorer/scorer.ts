// =============================================================
// scorer-v3full.ts — Main orchestrator
// =============================================================

import { layer0, layer1, layer2, layer3, layer4, layer5 } from "./layers.js";
import { computeNarrative } from "./narrative.js";
import { confidenceScore } from "./math.js";
import type { V3Input, V3Output } from "./types.js";

export const SCORER_VERSION = "v3.1.0";

export function scoreV3Full(input: V3Input): V3Output {
  const { snapshot, history = [], cohortPeers = [], snapshotCount } = input;
  const snapCount = snapshotCount ?? history.length + 1;

  // ── Run pipeline ──────────────────────────────────────────
  const l0 = layer0(snapshot);
  const l1 = layer1(snapshot, l0);
  const l2 = layer2(snapshot, l0, l1);
  const l3 = layer3(snapshot, l2, history);
  const l4 = layer4(
    snapshot,
    l2.activity * 0.3 +
      l2.impact * 0.35 +
      l2.quality * 0.2 +
      l2.consistency * 0.15,
    cohortPeers,
  );
  const l5 = layer5(l3, l1, history, snapCount, l0);

  // Previous sub-scores for tension detection
  const prevSubScores =
    history.length > 0 && history[history.length - 1]!.subScores
      ? history[history.length - 1]!.subScores!
      : undefined;

  const l6 = computeNarrative(l1, l2, l3, l4, l5, snapCount, prevSubScores);

  const conf = confidenceScore(snapCount, l0.dataQualityScore);

  const allWarnings = [...l0.warnings];

  return {
    finalScore: Math.round(l5.shapedScore * 100) / 100,
    archetype: l5.archetype,
    percentileRank: l4.percentileRank,
    confidence: Math.round(conf * 1000) / 1000,
    confidenceLevel: l5.confidenceLevel,
    confidenceInterval: l5.confidenceInterval,
    momentum: l3.momentumLabel,
    trend: Math.round(l3.velocity * 100) / 100,
    subScores: {
      activity: Math.round(l3.activity * 100) / 100,
      impact: Math.round(l3.impact * 100) / 100,
      quality: Math.round(l3.quality * 100) / 100,
      consistency: Math.round(l3.consistency * 100) / 100,
      reach: Math.round(l3.reach * 100) / 100,
    },
    antiExploit: {
      spamFlagged: l2.spamPenaltyApplied,
      singleRepoConcentration: l1.spamFlags.singleRepoConcentration,
      lowSubstanceCommits: l1.spamFlags.lowSubstanceCommits,
      pushToPrMergeAnomaly: l1.spamFlags.pushToMergeRatioAnomaly,
    },
    narrative: l6,
    layers: { l0, l1, l2, l3, l4, l5 },
    meta: {
      scorerVersion: SCORER_VERSION,
      computedAt: new Date(),
      warnings: allWarnings,
    },
  };
}
