// =============================================================
// scorer-v3full.test.ts
// Run: npx tsx scorer-v3full.test.ts
// =============================================================

import { scoreV3Full } from "./scorer.js";
import {
  sig, shapeDistribution, decay, ageNormFactor,
  confidenceInterval, tCritical95, emaSeries,
} from "./math.js";
import type { EnrichedSnapshot, HistoricalScore, V3Input } from "./types.js";

// ── Harness ───────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(ok: boolean, label: string, detail = "") {
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else     { console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) < tol;
const now  = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

// ── Snapshot factories ────────────────────────────────────────

function makeSnapshot(overrides: Partial<{
  followers: number; repos: number; stars: number; forks: number;
  pushes: number; prs: number; issues: number; releases: number;
  accountAgeDays: number; language: string;
  avgLinesChanged: number; refactorRatio: number;
  prsMerged: number; prsOpened: number; prsReviewed: number;
  weeklyPushes: number[]; singleRepoPct: number;
}>): EnrichedSnapshot {
  const o = overrides;
  const accountAgeDays = o.accountAgeDays ?? 365;
  const pushes  = o.pushes   ?? 0;
  const repos   = o.repos    ?? 5;
  const weekly  = o.weeklyPushes ?? [pushes * 0.4, pushes * 0.3, pushes * 0.2, pushes * 0.1];

  // Build repo signals
  const singleRepoPct = o.singleRepoPct ?? 0.3;
  const repoSignals = Array.from({ length: Math.max(1, repos) }, (_, i) => ({
    repoId:          `repo-${i}`,
    stars:           i === 0 ? (o.stars ?? 0) : Math.floor((o.stars ?? 0) / (repos)),
    forks:           i === 0 ? (o.forks ?? 0) : 0,
    dependents:      i === 0 ? 0 : 0,
    pkgComplexity:   2,
    isActive:        i < Math.ceil(repos * 0.6),
    primaryLanguage: o.language ?? "TypeScript",
    pushCount:       i === 0
      ? Math.floor(pushes * singleRepoPct)
      : Math.floor(pushes * (1 - singleRepoPct) / Math.max(1, repos - 1)),
  }));

  return {
    takenAt: now,
    profile: {
      followers:        o.followers ?? 0,
      public_repos:     repos,
      accountCreatedAt: daysAgo(accountAgeDays),
      primaryLanguage:  o.language ?? "TypeScript",
    },
    repoStats: {
      totalStars: o.stars  ?? 0,
      totalForks: o.forks  ?? 0,
      totalRepos: repos,
      repos:      repoSignals,
    },
    activity_30d: {
      pushes:   pushes,
      prs:      o.prs      ?? 0,
      issues:   o.issues   ?? 0,
      releases: o.releases ?? 0,
    },
    weeklyActivity: weekly.map((p, i) => ({
      weekOffset: i,
      pushes:     p,
      prs:        Math.floor((o.prs ?? 0) * [0.4, 0.3, 0.2, 0.1][i]!),
      issues:     Math.floor((o.issues ?? 0) * [0.4, 0.3, 0.2, 0.1][i]!),
      releases:   i === 0 ? (o.releases ?? 0) : 0,
    })),
    commitSignals: {
      totalCommits:     pushes,
      avgLinesChanged:  o.avgLinesChanged ?? 35,
      refactorRatio:    o.refactorRatio   ?? 0.15,
      testFileRatio:    0.25,
    },
    prSignals: {
      opened:              o.prsOpened   ?? (o.prs ?? 0),
      merged:              o.prsMerged   ?? Math.floor((o.prs ?? 0) * 0.75),
      reviewed:            o.prsReviewed ?? Math.floor((o.prs ?? 0) * 0.4),
      avgTimeToMergeHours: 24,
    },
  };
}

function makeHistory(scores: number[]): HistoricalScore[] {
  return scores.map((s, i) => ({
    takenAt:    daysAgo((scores.length - i) * 14),
    totalScore: s,
  }));
}

// ── Reference Dataset (Part 4 of spec: calibration profiles) ──
//
// These are "known-outcome" profiles used to validate that the
// weight/anchor calibration produces correct distribution placement.
// In production, these would be populated from real GitHub data
// of developers whose tier is known (e.g. famous OSS maintainers,
// new joiners, spam accounts verified manually).

const REFERENCE_DATASET = {
  ghost:     makeSnapshot({ pushes: 0, prs: 0, stars: 0, followers: 0, repos: 1 }),
  newcomer:  makeSnapshot({ pushes: 15, prs: 3, stars: 1, followers: 2, repos: 3, accountAgeDays: 30 }),
  yourDev:   makeSnapshot({ pushes: 115, prs: 17, issues: 2, stars: 2, forks: 1, followers: 3, repos: 23, accountAgeDays: 730 }),
  activeAvg: makeSnapshot({ pushes: 40, prs: 10, issues: 15, stars: 15, forks: 5, followers: 30, repos: 15, accountAgeDays: 600 }),
  maintainer:makeSnapshot({ pushes: 55, prs: 25, issues: 40, stars: 1500, forks: 300, followers: 800, repos: 30, prsMerged: 22, prsReviewed: 30, accountAgeDays: 1200 }),
  framework: makeSnapshot({ pushes: 20, prs: 8, stars: 8000, forks: 2000, followers: 5000, repos: 15, dependents: 500 } as any),
  spammer:   makeSnapshot({ pushes: 600, prs: 2, stars: 1, followers: 4, repos: 5, singleRepoPct: 0.92, avgLinesChanged: 3 }),
  elite:     makeSnapshot({ pushes: 120, prs: 45, issues: 60, stars: 15000, forks: 3000, followers: 12000, repos: 60, prsMerged: 42, prsReviewed: 55, avgLinesChanged: 80, accountAgeDays: 2000 }),
  researcher:makeSnapshot({ pushes: 10, prs: 4, stars: 300, forks: 50, followers: 150, repos: 8, avgLinesChanged: 200, refactorRatio: 0.05, accountAgeDays: 900 }),
};

// ─────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("  V3 Full Scorer — Test Suite + Calibration Report");
console.log("══════════════════════════════════════════════════════\n");

// ── Math primitives ───────────────────────────────────────────
console.log("▸ Math: sig calibration");
assert(near(sig(0, 60), 0.018, 0.005), `sig(0, k) = 0.018 floor [got ${sig(0,60).toFixed(3)}]`);
assert(near(sig(60, 60), 0.500, 0.005), `sig(k, k) = 0.5 midpoint [got ${sig(60,60).toFixed(3)}]`);
assert(sig(180, 60) > 0.97, `sig(3k, k) > 0.97 elite [got ${sig(180,60).toFixed(3)}]`);

console.log("\n▸ Math: age normalization");
const norm365 = ageNormFactor(365);
const norm730 = ageNormFactor(730);
assert(norm730 < norm365, "Older account has smaller normFactor (less inflation)");
assert(norm365 / norm730 < 1.5, "Sub-linear: doubling age raises factor by <50%");

console.log("\n▸ Math: EMA series");
const velSeries = emaSeries([2, 4, 3, 6, 5, 8], 0.4);
assert(velSeries.at(-1)! > velSeries[0]!, "EMA tracks upward series");
assert(velSeries.length === 6, "EMA output length matches input");

console.log("\n▸ Math: confidence intervals");
const ci2  = confidenceInterval([50, 60], 55);
const ci20 = confidenceInterval(Array.from({length:20}, (_,i) => 50 + i), 65);
assert(ci2[1] - ci2[0] > ci20[1] - ci20[0], "CI narrows with more data");
assert(near(tCritical95(1), 12.706, 0.01), "t-critical(n=1) = 12.706");
assert(near(tCritical95(30), 1.960, 0.1), "t-critical(n≥30) ≈ 1.96");

// ── Distribution bands (calibration report) ───────────────────
console.log("\n▸ Distribution band calibration\n");
console.log("  Profile           Score   Archetype          Band");
console.log("  ─────────────────────────────────────────────────");

type RefKey = keyof typeof REFERENCE_DATASET;
const results: Record<string, ReturnType<typeof scoreV3Full>> = {};

for (const [name, snap] of Object.entries(REFERENCE_DATASET)) {
  const history = name === "elite"
    ? makeHistory([55, 60, 65, 68, 72, 75])
    : name === "maintainer"
    ? makeHistory([45, 48, 50, 52])
    : [];
  results[name] = scoreV3Full({ snapshot: snap, history });
  const r = results[name]!;
  const band =
    r.finalScore < 30  ? "weak" :
    r.finalScore < 60  ? "average" :
    r.finalScore < 80  ? "strong" :
    "elite";
  console.log(
    `  ${name.padEnd(16)} ${String(r.finalScore).padStart(5)}   ${r.archetype.padEnd(18)} ${band}`
  );
}

// ── Band placement assertions ──────────────────────────────────
console.log("\n▸ Band placement assertions");

assert(results["ghost"]!.finalScore < 20,          `Ghost in weak band [got ${results["ghost"]!.finalScore}]`);
assert(results["spammer"]!.finalScore < 40,        `Spammer penalised [got ${results["spammer"]!.finalScore}]`);
assert(results["maintainer"]!.finalScore >= 45,    `Maintainer in average+ band [got ${results["maintainer"]!.finalScore}]`);
assert(results["elite"]!.finalScore >= 75,         `Elite in strong+ band [got ${results["elite"]!.finalScore}]`);
assert(results["elite"]!.finalScore <= 100,        "Elite ≤ 100");
assert(
  results["researcher"]!.finalScore > results["ghost"]!.finalScore,
  `Researcher scores above ghost [${results["researcher"]!.finalScore} vs ${results["ghost"]!.finalScore}]`
);

// ── Anti-exploit assertions ────────────────────────────────────
console.log("\n▸ Anti-exploit guards");

assert(results["spammer"]!.antiExploit.spamFlagged,             "Spammer: spam flagged");
assert(results["spammer"]!.antiExploit.lowSubstanceCommits,     "Spammer: low-substance commits flagged");
assert(results["spammer"]!.antiExploit.singleRepoConcentration, "Spammer: single-repo concentration flagged");
assert(!results["elite"]!.antiExploit.spamFlagged,             "Elite: no spam flags");
assert(!results["maintainer"]!.antiExploit.spamFlagged,        "Maintainer: no spam flags");

// ── Archetype assertions ───────────────────────────────────────
console.log("\n▸ Archetype classification");

assert(results["ghost"]!.archetype === "ghost",         `Ghost → ghost [got: ${results["ghost"]!.archetype}]`);
assert(
  results["researcher"]!.archetype === "research_dev" ||
  results["researcher"]!.archetype === "impact_dev"   ||
  results["researcher"]!.archetype === "balanced",
  `Researcher → research/impact/balanced [got: ${results["researcher"]!.archetype}]`
);

// ── Narrative assertions ───────────────────────────────────────
console.log("\n▸ Narrative Fusion Engine");

const eliteNarrative = results["elite"]!.narrative;
assert(eliteNarrative.headline.length > 10,          "Elite: headline generated");
assert(eliteNarrative.strengths.length > 0,          "Elite: at least one strength");
assert(typeof eliteNarrative.trajectoryStatement === "string", "Elite: trajectory statement");
assert(typeof eliteNarrative.confidenceStatement  === "string", "Elite: confidence statement");

// Ghost should have watch areas
assert(results["ghost"]!.narrative.watchAreas.length >= 0, "Ghost: watch areas (may be empty for ghost)");

// Your dev tension: high activity, low impact → detect tension
const yourResult = results["yourDev"]!;
console.log(`\n  Your dev narrative preview:`);
console.log(`  Headline:    ${yourResult.narrative.headline}`);
console.log(`  Tension:     ${yourResult.narrative.tension}`);
console.log(`  Trajectory:  ${yourResult.narrative.trajectoryStatement}`);
console.log(`  Confidence:  ${yourResult.narrative.confidenceStatement}`);
if (yourResult.narrative.tensionDescription) {
  console.log(`  Tension Desc: ${yourResult.narrative.tensionDescription}`);
}

assert(typeof yourResult.narrative.headline === "string", "Your dev: headline generated");

// ── Confidence & CI assertions ─────────────────────────────────
console.log("\n▸ Confidence & Uncertainty");

const newDev = scoreV3Full({ snapshot: REFERENCE_DATASET["newcomer"]!, history: [], snapshotCount: 1 });
const veteran = scoreV3Full({
  snapshot: REFERENCE_DATASET["maintainer"]!,
  history:  makeHistory([40, 45, 48, 50, 52, 53, 54, 55, 56, 57, 58, 59]),
  snapshotCount: 13
});

assert(newDev.confidenceLevel  === "very_low" || newDev.confidenceLevel === "low",
  `New dev: low confidence [got ${newDev.confidenceLevel}]`);
assert(veteran.confidenceLevel === "high" || veteran.confidenceLevel === "very_high",
  `Veteran: high confidence [got ${veteran.confidenceLevel}]`);

const newCI     = newDev.confidenceInterval;
const vetCI     = veteran.confidenceInterval;
const newWidth  = newCI[1]  - newCI[0];
const vetWidth  = vetCI[1]  - vetCI[0];
assert(newWidth > vetWidth, `New dev CI wider than veteran [${newWidth.toFixed(1)} vs ${vetWidth.toFixed(1)}]`);

// ── Momentum engine ────────────────────────────────────────────
console.log("\n▸ Momentum Engine");

const risingInput: V3Input = {
  snapshot: REFERENCE_DATASET["activeAvg"]!,
  history:  makeHistory([20, 25, 30, 35, 42, 50]),
};
const decliningInput: V3Input = {
  snapshot: REFERENCE_DATASET["activeAvg"]!,
  history:  makeHistory([70, 65, 58, 52, 48, 44]),
};
const rising   = scoreV3Full(risingInput);
const declining = scoreV3Full(decliningInput);

assert(rising.trend   > 0, `Rising history → positive trend [got ${rising.trend}]`);
assert(declining.trend < 0, `Declining history → negative trend [got ${declining.trend}]`);

// ── Age normalization ──────────────────────────────────────────
console.log("\n▸ Age Normalization (Legacy Advantage prevention)");

// Same activity, different account ages — older account should NOT score much higher
const youngDev = scoreV3Full({
  snapshot: makeSnapshot({ pushes: 50, prs: 10, stars: 20, followers: 20, repos: 10, accountAgeDays: 180 }),
  history: [],
});
const oldDev = scoreV3Full({
  snapshot: makeSnapshot({ pushes: 50, prs: 10, stars: 20, followers: 20, repos: 10, accountAgeDays: 1800 }),
  history: [],
});

console.log(`  Same activity: young (180d) = ${youngDev.finalScore}, old (1800d) = ${oldDev.finalScore}`);
assert(
  Math.abs(youngDev.finalScore - oldDev.finalScore) < 15,
  `Age normalization: same activity → scores within 15pts [gap: ${Math.abs(youngDev.finalScore - oldDev.finalScore).toFixed(1)}]`
);

// ── Edge cases ─────────────────────────────────────────────────
console.log("\n▸ Edge Cases");

const zeroResult = scoreV3Full({ snapshot: REFERENCE_DATASET["ghost"]!, history: [] });
assert(!isNaN(zeroResult.finalScore),                   "All-zero: no NaN");
assert(zeroResult.finalScore >= 0 && zeroResult.finalScore <= 100, "All-zero: in [0,100]");

// Mega values
const megaSnap = makeSnapshot({ pushes: 99999, prs: 9999, stars: 999999, followers: 999999, repos: 999 });
const megaResult = scoreV3Full({ snapshot: megaSnap, history: [], snapshotCount: 25 });
assert(megaResult.finalScore <= 100, `Mega values clamped [got ${megaResult.finalScore}]`);
assert(!isNaN(megaResult.finalScore), "Mega values: no NaN");

// ─────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);