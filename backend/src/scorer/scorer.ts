// =============================================================
// scorer-v3.ts — V3 pipeline orchestrator
// =============================================================

import { layer1, layer2, layer3, layer4 } from "./layers.js";
import type { V3Input, V3Output } from "./types.js";

export const SCORER_VERSION = "v3.0.0";

export function scoreV3(input: V3Input): V3Output {
  const warnings: string[] = [];
  const computedAt = new Date();

  const {
    profile,
    history = [],
    snapshotCount = history.length + 1,
  } = input;

  // Defensive: warn when weekly data is absent (L3 uses fallback)
  const weeklySlices = profile.weeklyActivity ?? [];
  if (weeklySlices.length === 0) {
    warnings.push(
      "weeklyActivity missing — temporal decay uses 15-day midpoint fallback"
    );
  }

  // ── Run pipeline ──────────────────────────────────────────
  const l1 = layer1(profile);
  const l2 = layer2(l1, weeklySlices);
  const l3 = layer3(l2, weeklySlices);
  const l4 = layer4(l3, l2, history, snapshotCount);

  // Anti-exploit summary
  const burstFlagged = l2.burstRatio > 3.0; // matches BURST_RATIO_THRESHOLD in layers.ts
  if (l2.spamPenaltyApplied) warnings.push("Spam guard triggered: high push-to-PR ratio");
  if (burstFlagged)          warnings.push("Burst guard triggered: peak week >4× average");

  return {
    finalScore:  Math.round(l4.finalScore  * 100) / 100,
    archetype:   l4.archetype,
    confidence:  l4.confidence,
    trend:       l4.trend,
    trendLabel:  l4.trendLabel,
    subScores: {
      activity:    Math.round(l3.activity    * 100) / 100,
      impact:      Math.round(l3.impact      * 100) / 100,
      consistency: Math.round(l3.consistency * 100) / 100,
      reach:       Math.round(l3.reach       * 100) / 100,
    },
    antiExploit: {
      spamFlagged:   l2.spamPenaltyApplied,
      burstFlagged,
      pushToPrRatio: Math.round(l2.pushToPrRatio * 10) / 10,
      burstRatio:    Math.round(l2.burstRatio    * 10) / 10,
    },
    layers: { l1, l2, l3, l4 },
    meta: {
      scorerVersion: SCORER_VERSION,
      computedAt,
      warnings,
    },
  };
}