import type { PortfolioDocument } from "../../db/models/portfolio.model.js";

import type { ParsedPortfolio } from "./types.js";

export type PageExtraction = {
  parsed: ParsedPortfolio;
  pageUrl: string;
  score: number; // Page-level crawl score (0–1)
};

// ─── Main merge ───────────────────────────────────────────────────────────────

/**
 * Merges multiple per-page extractions into a single portfolio record.
 *
 * Strategy:
 *  - Identity/positioning: first non-null wins (sorted by page score desc)
 *  - Arrays (skills, stack): union with deduplication
 *  - Projects: merge by name, accumulate fields, keep higher confidence
 *  - Proof: union all, first non-null wins for single-value fields
 *  - Quality: weighted average by page score
 *  - Signals: union, but only flag missing_information if majority of pages agree
 *
 * Pages are sorted by score descending before processing,
 * so higher-quality pages win ties on scalar fields.
 */
export function mergePortfolioPages(
  extractions: PageExtraction[],
): ParsedPortfolio {
  if (extractions.length === 0) {
    throw new Error("mergePortfolioPages: received zero extractions");
  }

  if (extractions.length === 1) {
    return extractions[0].parsed;
  }

  // Sort by page score descending — highest quality pages win ties
  const sorted = [...extractions].sort((a, b) => b.score - a.score);

  return {
    identity: mergeIdentity(sorted),
    positioning: mergePositioning(sorted),
    skills: mergeSkills(sorted),
    projects: mergeProjects(sorted),
    proof: mergeProof(sorted),
    narrative: mergeNarrative(sorted),
    signals: mergeSignals(sorted),
    quality: mergeQuality(sorted),
    warnings: mergeWarnings(sorted),
  };
}

// ─── Field mergers ────────────────────────────────────────────────────────────

function mergeIdentity(sorted: PageExtraction[]): ParsedPortfolio["identity"] {
  return {
    name: firstNonNull(sorted, (p) => p.identity?.name),
    alias: firstNonNull(sorted, (p) => p.identity?.alias),
    headline: firstNonNull(sorted, (p) => p.identity?.headline),
    bio_summary: firstNonNull(sorted, (p) => p.identity?.bio_summary),
    location: firstNonNull(sorted, (p) => p.identity?.location),
    canonical_identity: firstNonNull(
      sorted,
      (p) => p.identity?.canonical_identity,
    ),
  };
}

function mergePositioning(
  sorted: PageExtraction[],
): ParsedPortfolio["positioning"] {
  return {
    primary_positioning: firstNonNull(
      sorted,
      (p) => p.positioning?.primary_positioning,
    ),
    secondary_positioning: dedupe(
      sorted.flatMap((e) => e.parsed.positioning?.secondary_positioning ?? []),
    ),
    self_image_keywords: dedupe(
      sorted.flatMap((e) => e.parsed.positioning?.self_image_keywords ?? []),
    ),
    tone: firstNonNull(sorted, (p) => p.positioning?.tone),
    assertiveness: firstNonNull(
      sorted,
      (p) => p.positioning?.assertiveness,
    ) as any,
  };
}

function mergeSkills(sorted: PageExtraction[]): ParsedPortfolio["skills"] {
  return {
    claimed: dedupe(sorted.flatMap((e) => e.parsed.skills?.claimed ?? [])),
    stack: dedupe(sorted.flatMap((e) => e.parsed.skills?.stack ?? [])),
    categories: {
      frontend: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.frontend ?? []),
      ),
      backend: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.backend ?? []),
      ),
      ai_ml: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.ai_ml ?? []),
      ),
      databases: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.databases ?? []),
      ),
      devops: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.devops ?? []),
      ),
      other: dedupe(
        sorted.flatMap((e) => e.parsed.skills?.categories?.other ?? []),
      ),
    },
  };
}

function mergeProjects(sorted: PageExtraction[]): ParsedPortfolio["projects"] {
  const allProjects = sorted.flatMap((e) => e.parsed.projects ?? []);

  if (allProjects.length === 0) return [];

  // Group by normalized name for deduplication/merging
  const byName = new Map<
    string,
    NonNullable<ParsedPortfolio["projects"]>[number]
  >();
  const unnamed: typeof allProjects = [];

  for (const project of allProjects) {
    if (!project.name) {
      unnamed.push(project);
      continue;
    }

    const key = project.name.toLowerCase().trim();
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, project);
    } else {
      byName.set(key, mergeProjectPair(existing, project));
    }
  }

  const merged = [...byName.values(), ...unnamed];

  // Sort by confidence descending
  return merged.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

/**
 * Merges two project entries that refer to the same project (same name).
 * Higher-confidence version wins on each scalar field.
 * Arrays (stack, links.other) are unioned.
 */
function mergeProjectPair(
  a: NonNullable<ParsedPortfolio["projects"]>[number],
  b: NonNullable<ParsedPortfolio["projects"]>[number],
): NonNullable<ParsedPortfolio["projects"]>[number] {
  const [hi, lo] = (a.confidence ?? 0) >= (b.confidence ?? 0) ? [a, b] : [b, a];

  return {
    name: hi.name ?? lo.name,
    type: hi.type ?? lo.type,
    summary: hi.summary ?? lo.summary,
    problem: hi.problem ?? lo.problem,
    approach: hi.approach ?? lo.approach,
    impact: hi.impact ?? lo.impact,
    role: hi.role ?? lo.role,
    stack: dedupe([...(hi.stack ?? []), ...(lo.stack ?? [])]),
    status: hi.status ?? lo.status,
    date: hi.date ?? lo.date,
    links: {
      live_demo: hi.links?.live_demo ?? lo.links?.live_demo,
      code: hi.links?.code ?? lo.links?.code,
      case_study: hi.links?.case_study ?? lo.links?.case_study,
      other: dedupe([...(hi.links?.other ?? []), ...(lo.links?.other ?? [])]),
    },
    confidence: Math.max(a.confidence ?? 0, b.confidence ?? 0),
  };
}

function mergeProof(sorted: PageExtraction[]): ParsedPortfolio["proof"] {
  return {
    github: firstNonNull(sorted, (p) => p.proof?.github),
    linkedin: firstNonNull(sorted, (p) => p.proof?.linkedin),
    devpost: firstNonNull(sorted, (p) => p.proof?.devpost),
    other_profiles: dedupe(
      sorted.flatMap((e) => e.parsed.proof?.other_profiles ?? []),
    ),
    awards: dedupeAwards(sorted.flatMap((e) => e.parsed.proof?.awards ?? [])),
    demos: dedupe(sorted.flatMap((e) => e.parsed.proof?.demos ?? [])),
    publications: dedupe(
      sorted.flatMap((e) => e.parsed.proof?.publications ?? []),
    ),
    canons: dedupe(sorted.flatMap((e) => e.parsed.proof?.canons ?? [])),
  };
}

function mergeNarrative(
  sorted: PageExtraction[],
): ParsedPortfolio["narrative"] {
  const defaultNarrative: ParsedPortfolio["narrative"] = {
    structure: null,
    story_arc: null,
    has_problem_solution_flow: null,
    has_case_study_depth: null,
    has_timeline: null,
    depth_level: null,
  };

  if (sorted.length === 0) return defaultNarrative;

  const depthOrder: Record<string, number> = {
    deep: 3,
    medium: 2,
    shallow: 1,
  };

  const withNarrative = sorted
    .map((e) => e.parsed.narrative)
    .filter((n): n is NonNullable<typeof n> => n != null);

  if (withNarrative.length === 0) return defaultNarrative;

  const richest = [...withNarrative].sort(
    (a, b) =>
      (depthOrder[b.depth_level ?? ""] ?? 0) -
      (depthOrder[a.depth_level ?? ""] ?? 0),
  )[0];

  return {
    ...defaultNarrative,
    ...richest,
    has_problem_solution_flow:
      withNarrative.some((n) => n.has_problem_solution_flow === true) || null,
    has_case_study_depth:
      withNarrative.some((n) => n.has_case_study_depth === true) || null,
    has_timeline: withNarrative.some((n) => n.has_timeline === true) || null,
  };
}

function mergeSignals(sorted: PageExtraction[]): ParsedPortfolio["signals"] {
  return {
    strong_signals: dedupe(
      sorted.flatMap((e) => e.parsed.signals?.strong_signals ?? []),
    ),
    weak_signals: dedupe(
      sorted.flatMap((e) => e.parsed.signals?.weak_signals ?? []),
    ),
    generic_claims: dedupe(
      sorted.flatMap((e) => e.parsed.signals?.generic_claims ?? []),
    ),
    // Only keep missing_information items that the MAJORITY of pages agree are missing.
    // A single page saying "projects missing" shouldn't override other pages that found them.
    missing_information: consensusMissing(sorted),
    evidence: sorted.flatMap((e) => e.parsed.signals?.evidence ?? []),
  };
}

/**
 * An item is "missing" only if more than half of pages reported it as missing.
 * This prevents a low-content page from masking data found on another page.
 */
function consensusMissing(sorted: PageExtraction[]): string[] {
  const counts = new Map<string, number>();
  const total = sorted.length;

  for (const e of sorted) {
    for (const item of e.parsed.signals?.missing_information ?? []) {
      const key = item.toLowerCase().trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(total / 2);
  const result: string[] = [];

  for (const [item, count] of counts.entries()) {
    if (count >= threshold) result.push(item);
  }

  return result;
}

/**
 * Quality scores are weighted averages across pages, weighted by page score.
 * This means the root page (score=1.0) has more influence than a discovered
 * subpage (score=0.5).
 */
function mergeQuality(sorted: PageExtraction[]): ParsedPortfolio["quality"] {
  const qualities = sorted
    .map((e) => ({ quality: e.parsed.quality, weight: e.score }))
    .filter((e) => e.quality != null);

  if (qualities.length === 0) {
    return {
      overall_confidence: 0,
      identity_confidence: 0,
      skills_confidence: 0,
      projects_confidence: 0,
      proof_confidence: 0,
      noise_level: "high",
      extraction_risk: "high",
    };
  }

  const totalWeight = qualities.reduce((sum, e) => sum + e.weight, 0);

  const wavg = (
    getter: (q: NonNullable<ParsedPortfolio["quality"]>) => number,
  ): number => {
    const sum = qualities.reduce((acc, e) => {
      return acc + getter(e.quality!) * (e.weight / totalWeight);
    }, 0);
    return Math.round(sum * 1000) / 1000; // 3 decimal places
  };

  const overall = wavg((q) => q.overall_confidence ?? 0);
  const identity = wavg((q) => q.identity_confidence ?? 0);
  const skills = wavg((q) => q.skills_confidence ?? 0);
  const projects = wavg((q) => q.projects_confidence ?? 0);
  const proof = wavg((q) => q.proof_confidence ?? 0);

  const noiseLevel =
    overall >= 0.7 ? "low" : overall >= 0.4 ? "medium" : "high";
  const extractionRisk =
    overall >= 0.65 ? "low" : overall >= 0.35 ? "medium" : "high";

  return {
    overall_confidence: overall,
    identity_confidence: identity,
    skills_confidence: skills,
    projects_confidence: projects,
    proof_confidence: proof,
    noise_level: noiseLevel,
    extraction_risk: extractionRisk,
  };
}

function mergeWarnings(sorted: PageExtraction[]): string[] {
  return dedupe(sorted.flatMap((e) => e.parsed.warnings ?? []));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the first non-null/undefined value from sorted extractions.
 * Because sorted is ordered by page score desc, the highest-quality page wins.
 */
function firstNonNull<T>(
  sorted: PageExtraction[],
  getter: (p: ParsedPortfolio) => T | null | undefined,
): T | null {
  for (const e of sorted) {
    const val = getter(e.parsed);
    if (val != null) return val;
  }
  return null;
}

/** Case-insensitive string deduplication, preserving first occurrence. */
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item.trim());
  }
  return result;
}

/** Deduplicates awards by title+event+year composite key. */
function dedupeAwards(
  awards: NonNullable<ParsedPortfolio["proof"]>["awards"],
): NonNullable<ParsedPortfolio["proof"]>["awards"] {
  const seen = new Set<string>();
  return awards.filter((a) => {
    const key = [a.title ?? "", a.event ?? "", a.year ?? ""]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
