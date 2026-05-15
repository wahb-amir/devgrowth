import type { CleanedPage, TextBlock } from "./cleaner.js";
import type { PortfolioDocument } from "../../db/models/portfolio.model.js";
import { getCompiledSkills, type SkillCategory } from "./skills-dictionary.js";

import type {
  ParsedPortfolio,
  DeterministicResult,
  ProofData,
  AwardEntry,
  ProjectEntry,
  EvidenceEntry,
  ExtractionGaps,
} from "./types.js";
// ─── Local structural types ───────────────────────────────────────────────────
// Defined explicitly instead of indexing into Mongoose InferSchemaType.
// Mongoose's inferred types add optionality and DocumentArray wrappers that
// cause false errors when you try to .push() onto arrays or index with string keys.
// These interfaces are structurally identical to the schema — TypeScript
// verifies that at the return boundary of each function.

// ─── Entry point ──────────────────────────────────────────────────────────────

export function deterministicExtract(
  cleaned: CleanedPage,
  _pageUrl: string,
): DeterministicResult {
  const identity = extractIdentity(cleaned);
  const proof = extractProof(cleaned);
  const skills = extractSkills(cleaned);
  const projects = extractProjects(cleaned);
  const narrative = extractNarrative(cleaned, projects);
  const positioning = extractPositioning(cleaned, identity);
  const signals = buildSignals(identity, skills, projects, proof, cleaned);
  const quality = scoreQuality(identity, skills, projects, proof);
  const warnings = buildWarnings(identity, skills, projects, proof, cleaned);

  const parsed: ParsedPortfolio = {
    identity,
    positioning,
    skills,
    projects,
    proof,
    narrative,
    signals,
    quality,
    warnings,
  };

  return { parsed, gaps: assessGaps(parsed, cleaned) };
}

// ─── Identity ─────────────────────────────────────────────────────────────────

function extractIdentity(c: CleanedPage): ParsedPortfolio["identity"] {
  const name = extractName(c);
  const headline = extractHeadline(c);
  const bio_summary = extractBio(c);
  const location = extractLocation(c);
  const alias = extractAlias(c);
  return {
    name,
    alias,
    headline,
    bio_summary,
    location,
    canonical_identity: name,
  };
}

function extractName(c: CleanedPage): string | null {
  // Matches "Firstname Lastname | Role" — the most common personal site title pattern
  const NAME_RE =
    /^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z'\-]{1,20}){1,3})\s*[|\u2013\u2014\-]/;

  if (c.title) {
    const m = c.title.match(NAME_RE);
    if (m) return m[1].trim();
  }

  const ogTitle = c.ogData["og:title"] ?? c.ogData["twitter:title"];
  if (ogTitle) {
    const m = ogTitle.match(NAME_RE);
    if (m) return m[1].trim();
  }

  for (const b of c.textBlocks.filter((b) => b.tag === "h1")) {
    if (looksLikeName(b.text)) return b.text.trim();
  }

  // "John Doe is a..." or "John Doe (alias) is..."
  if (c.metaDescription) {
    const m = c.metaDescription.match(
      /^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z'\-]+){1,3})(?:\s+\([^)]+\))?\s+is\b/,
    );
    if (m) return m[1].trim();
  }

  return null;
}

function extractHeadline(c: CleanedPage): string | null {
  if (c.title) {
    const m = c.title.match(/[|\u2013\u2014]\s*(.+)$/);
    if (m) {
      const cand = m[1].trim();
      if (cand.length > 5 && cand.length < 160) return cand;
    }
  }

  const ogDesc = c.ogData["og:description"] ?? c.ogData["twitter:description"];
  if (ogDesc) {
    const first = ogDesc.split(/[.!?\n]/)[0].trim();
    if (first.length > 10 && first.length < 140) return first;
  }

  for (const b of sectionBlocks(c.textBlocks, "hero")) {
    if ((b.tag === "h1" || b.tag === "h2") && !looksLikeName(b.text))
      return b.text;
  }

  // Second H1: first = name, second = tagline
  const h1s = c.textBlocks.filter((b) => b.tag === "h1");
  if (h1s.length >= 2 && !looksLikeName(h1s[1].text)) return h1s[1].text;

  return null;
}

function extractBio(c: CleanedPage): string | null {
  if (c.metaDescription && c.metaDescription.length >= 80) {
    if (
      /\b(is\s+a|developer|engineer|designer|builder|creator|researcher|founder)\b/i.test(
        c.metaDescription,
      )
    ) {
      return c.metaDescription;
    }
  }

  for (const b of sectionBlocks(c.textBlocks, "about")) {
    if (b.tag === "p" && b.text.length >= 80) return b.text;
  }

  const ogDesc = c.ogData["og:description"];
  if (ogDesc && ogDesc.length >= 80) return ogDesc;

  return null; // → enricher candidate if about text exists
}

function extractLocation(c: CleanedPage): string | null {
  const haystack = [
    c.metaDescription ?? "",
    c.title ?? "",
    allText(c.textBlocks),
  ].join(" ");

  const patterns = [
    /\bBased\s+in\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[.|,\n]|$)/,
    /\bLocated\s+in\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[.|,\n]|$)/,
    /\bLiving\s+in\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[.|,\n]|$)/,
    /\b([A-Z][a-zA-Z]+,\s*[A-Z]{2,3})\b/, // "Austin, TX"
    /\b([A-Z][a-zA-Z]+,\s*[A-Z][a-zA-Z]+)\b/, // "Toronto, Canada"
  ];

  for (const p of patterns) {
    const m = haystack.match(p);
    if (m && m[1].length > 2 && m[1].length < 60) return m[1].trim();
  }
  return null;
}

function extractAlias(c: CleanedPage): string | null {
  const haystack = [
    c.metaDescription ?? "",
    c.title ?? "",
    c.ogData["og:title"] ?? "",
  ].join(" ");

  // "John Doe (johndoe) is a..."
  const m = haystack.match(
    /[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+\s+\(([a-zA-Z0-9_\-]{2,30})\)/,
  );
  if (m) return m[1];

  const tw = c.externalLinks.find((l) => /twitter\.com|x\.com/i.test(l.href));
  if (tw) {
    const hm = tw.href.match(/\/([a-zA-Z0-9_]{2,30})\/?$/);
    if (hm && !["home", "explore", "notifications", "search"].includes(hm[1])) {
      return `@${hm[1]}`;
    }
  }
  return null;
}

// ─── Positioning ──────────────────────────────────────────────────────────────

function extractPositioning(
  c: CleanedPage,
  identity: ParsedPortfolio["identity"],
): ParsedPortfolio["positioning"] {
  const heroAboutText = sectionBlocks(c.textBlocks, "hero", "about")
    .slice(0, 6)
    .map((b) => b.text)
    .join(" ");

  return {
    primary_positioning: identity?.headline ?? null,
    secondary_positioning: [],
    self_image_keywords: extractRoleKeywords(heroAboutText),
    tone: inferTone(c.textBlocks),
    assertiveness: inferAssertiveness(heroAboutText),
  };
}

const ROLE_NOUNS = [
  "developer",
  "engineer",
  "designer",
  "architect",
  "founder",
  "builder",
  "researcher",
  "consultant",
  "freelancer",
  "creator",
  "full-stack",
  "frontend",
  "backend",
  "fullstack",
];

function extractRoleKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return [...new Set(ROLE_NOUNS.filter((n) => lower.includes(n)))];
}

function inferTone(blocks: TextBlock[]): string | null {
  const text = blocks
    .slice(0, 20)
    .map((b) => b.text)
    .join(" ")
    .toLowerCase();
  const firstPerson = (text.match(/\bI\b|\bI'm\b|\bI've\b|\bmy\b/g) ?? [])
    .length;
  const technical = (
    text.match(/\b(api|repo|deploy|stack|build|debug|optimize)\b/g) ?? []
  ).length;
  const exclamations = (text.match(/!/g) ?? []).length;
  if (technical > 3) return "technical";
  if (firstPerson > 5 && exclamations > 1) return "casual";
  if (firstPerson > 5) return "personal";
  return "neutral";
}

function inferAssertiveness(text: string): "low" | "medium" | "high" | null {
  if (!text) return null;
  const hi = (
    text.match(
      /\b(expert|lead|senior|built|launched|scaled|shipped|created|own)\b/gi,
    ) ?? []
  ).length;
  const lo = (
    text.match(
      /\b(aspiring|learning|junior|studying|trying|hoping|beginner)\b/gi,
    ) ?? []
  ).length;
  if (hi > lo + 1) return "high";
  if (lo > hi) return "low";
  return "medium";
}

// ─── Skills ───────────────────────────────────────────────────────────────────

function extractSkills(c: CleanedPage): ParsedPortfolio["skills"] {
  const skillsText = allText(sectionBlocks(c.textBlocks, "skills"));
  const searchText = skillsText
    ? `${skillsText} ${allText(c.textBlocks)}`
    : allText(c.textBlocks);

  const found = new Map<string, SkillCategory>();
  for (const entry of getCompiledSkills()) {
    if (!found.has(entry.canonical) && entry.pattern.test(searchText)) {
      found.set(entry.canonical, entry.category);
    }
  }

  const cats: Record<SkillCategory, string[]> = {
    frontend: [],
    backend: [],
    ai_ml: [],
    databases: [],
    devops: [],
    other: [],
  };
  for (const [skill, cat] of found) cats[cat].push(skill);

  const all = [...found.keys()];
  return { claimed: all, stack: all, categories: cats };
}

// ─── Proof ────────────────────────────────────────────────────────────────────

// Typed as a string-key map so we can index it with `key` from SOCIAL
// without TypeScript complaining about implicit any.
type SocialKey = "github" | "linkedin" | "devpost";

const SOCIAL: Array<{
  key: SocialKey;
  re: RegExp;
  build: (m: RegExpMatchArray) => string;
}> = [
  {
    key: "github",
    re: /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,37}[a-zA-Z0-9])?)(?:\/|$)/i,
    build: (m) => `https://github.com/${m[1]}`,
  },
  {
    key: "linkedin",
    re: /linkedin\.com\/in\/([a-zA-Z0-9\-]{3,100})(?:\/|$)/i,
    build: (m) => `https://linkedin.com/in/${m[1]}`,
  },
  {
    key: "devpost",
    re: /devpost\.com\/([a-zA-Z0-9\-]{3,100})(?:\/|$)/i,
    build: (m) => `https://devpost.com/${m[1]}`,
  },
];

const OTHER_PROFILE_RE: RegExp[] = [
  /twitter\.com\/([a-zA-Z0-9_]{1,50})(?:\/|$)/i,
  /x\.com\/([a-zA-Z0-9_]{1,50})(?:\/|$)/i,
  /behance\.net\/[a-zA-Z0-9\-]{1,50}/i,
  /dribbble\.com\/[a-zA-Z0-9\-]{1,50}/i,
  /medium\.com\/@?[a-zA-Z0-9\-]{1,50}/i,
  /dev\.to\/[a-zA-Z0-9\-]{1,50}/i,
  /hashnode\.dev\/[a-zA-Z0-9\-]{1,50}/i,
  /youtube\.com\/@?[a-zA-Z0-9\-]{1,100}/i,
  /leetcode\.com\/u\/[a-zA-Z0-9\-]{1,50}/i,
  /codepen\.io\/[a-zA-Z0-9\-]{1,50}/i,
  /stackoverflow\.com\/users\/\d+/i,
];

const KNOWN_PROFILE_DOMAINS =
  /github|linkedin|twitter|x\.com|devpost|behance|dribbble|medium|dev\.to|youtube|twitch|leetcode|codepen|stackoverflow|npmjs/i;

function extractProof(c: CleanedPage): ProofData {
  // Plain object with explicit types — no Mongoose inference issues.
  // Shape is verified against ParsedPortfolio["proof"] at the return boundary
  // of deterministicExtract via structural typing.
  const result: ProofData = {
    github: null,
    linkedin: null,
    devpost: null,
    other_profiles: [],
    awards: [],
    demos: [],
    publications: [],
    canons: [],
  };

  for (const { href } of c.externalLinks) {
    // Primary social profiles — use explicit key to index result
    for (const { key, re, build } of SOCIAL) {
      if (!result[key]) {
        const m = href.match(re);
        if (m) {
          if (
            key === "github" &&
            /\/(sponsors|explore|trending|marketplace|features)/.test(href)
          ) {
            continue;
          }
          result[key] = build(m);
        }
      }
    }

    // Other profile platforms
    for (const re of OTHER_PROFILE_RE) {
      if (re.test(href) && !result.other_profiles.includes(href)) {
        result.other_profiles.push(href);
      }
    }

    // Demo / deployed app links — anything external that isn't a social profile
    if (!KNOWN_PROFILE_DOMAINS.test(href) && /^https?:\/\//.test(href)) {
      if (result.demos.length < 10) result.demos.push(href);
    }
  }

  // Awards — meta description is the single highest-signal source for personal sites.
  // e.g. "Technical Award at Hackonomics 2026 · 3rd Place at Hack for Humanity 2026"
  const awardSource = [
    c.metaDescription ?? "",
    ...sectionBlocks(c.textBlocks, "achievements").map((b) => b.text),
    ...c.textBlocks
      .filter((b) =>
        /award|prize|hackathon|winner|finalist|place/i.test(b.text),
      )
      .map((b) => b.text),
  ].join(" | ");

  result.awards = extractAwards(awardSource);

  return result;
}

function extractAwards(text: string): AwardEntry[] {
  const awards: AwardEntry[] = [];
  const seen = new Set<string>();

  // Split on common award list separators (·, •, |, newline)
  const segments = text
    .split(/\s*[·•|\n]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // "1st/2nd/3rd Place at Event [Year]"
    const pm = seg.match(
      /\b(\d+(?:st|nd|rd|th)\s+[Pp]lace)\s+(?:at\s+)?([A-Z][A-Za-z0-9&'\s\-]{3,60}?)(?:\s+(\d{4}))?(?:\s*$)/,
    );
    if (pm) {
      const k = `${pm[1]}|${pm[2]}`.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        awards.push({
          title: pm[1].trim(),
          event: pm[2].trim(),
          year: pm[3] ?? null,
          evidence: seg,
        });
      }
      continue;
    }

    // "X Award / Prize / Trophy at Event [Year]"
    const am = seg.match(
      /\b([A-Z][A-Za-z\s]+?(?:[Aa]ward|[Pp]rize|[Tt]rophy|[Ff]ellowship))\s+(?:at\s+)?([A-Z][A-Za-z0-9&'\s\-]{3,60}?)(?:\s+(\d{4}))?(?:\s*$)/,
    );
    if (am) {
      const k = `${am[1]}|${am[2]}`.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        awards.push({
          title: am[1].trim(),
          event: am[2].trim(),
          year: am[3] ?? null,
          evidence: seg,
        });
      }
      continue;
    }

    // "Winner at/of Event [Year]"
    const wm = seg.match(
      /\b[Ww]inner\s+(?:at|of)\s+([A-Z][A-Za-z0-9&'\s\-]{3,60}?)(?:\s+(\d{4}))?(?:\s*$)/,
    );
    if (wm) {
      const k = `winner|${wm[1]}`.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        awards.push({
          title: "Winner",
          event: wm[1].trim(),
          year: wm[2] ?? null,
          evidence: seg,
        });
      }
    }
  }

  return awards.slice(0, 20);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

function extractProjects(c: CleanedPage): ProjectEntry[] {
  const blocks = sectionBlocks(c.textBlocks, "projects");
  if (blocks.length === 0) return [];

  const groups = groupByHeadings(blocks);
  if (groups.length === 0) return [];

  const compiled = getCompiledSkills();

  return groups.slice(0, 15).map(({ heading, body }): ProjectEntry => {
    const bodyText = body.map((b) => b.text).join(" ");

    const stack = compiled
      .filter(({ pattern }) => pattern.test(bodyText))
      .map(({ canonical }) => canonical);

    const codeLink =
      c.externalLinks.find(
        (l) =>
          /github\.com\/[^/]+\/[^/]+/i.test(l.href) &&
          matchesProject(l.text, heading),
      )?.href ?? null;

    const demoLink =
      c.externalLinks.find(
        (l) =>
          !KNOWN_PROFILE_DOMAINS.test(l.href) &&
          !/github/i.test(l.href) &&
          (matchesProject(l.text, heading) ||
            /\b(demo|live|view|visit|preview)\b/i.test(l.text)),
      )?.href ?? null;

    let conf = 0.3;
    if (bodyText.length > 50) conf += 0.2;
    if (stack.length > 0) conf += 0.2;
    if (codeLink || demoLink) conf += 0.15;
    if (bodyText.length > 200) conf += 0.1;

    return {
      name: heading,
      type: inferProjectType(bodyText, heading),
      summary: null,
      problem: null,
      approach: null,
      impact: null,
      role: null,
      stack,
      status: inferStatus(bodyText),
      date: extractDate(bodyText),
      links: {
        live_demo: demoLink,
        code: codeLink,
        case_study: null,
        other: [],
      },
      confidence: Math.min(conf, 0.75),
    };
  });
}

function matchesProject(linkText: string, projectName: string): boolean {
  const firstWord = projectName.split(/\s/)[0].toLowerCase();
  return linkText.toLowerCase().includes(firstWord);
}

function inferProjectType(text: string, name: string): string | null {
  const s = `${text} ${name}`.toLowerCase();
  if (/hackathon/.test(s)) return "hackathon project";
  if (/\bcli\b|command[- ]line/.test(s)) return "CLI tool";
  if (/chrome\s*extension|browser\s*extension/.test(s))
    return "browser extension";
  if (/\bmobile\b|ios\b|android\b/.test(s)) return "mobile app";
  if (/\bapi\b|microservice/.test(s)) return "API / service";
  if (/\blibrary\b|\bpackage\b|\bnpm\b|\bsdk\b/.test(s))
    return "library / package";
  if (/dashboard/.test(s)) return "dashboard";
  return "web app";
}

function inferStatus(text: string): string | null {
  const l = text.toLowerCase();
  if (/\blive\b|deployed|production/.test(l)) return "live";
  if (/open.?source/.test(l)) return "open source";
  if (/archived/.test(l)) return "archived";
  if (/in.?progress|wip/.test(l)) return "in progress";
  return null;
}

function extractDate(text: string): string | null {
  const my = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})\b/i,
  );
  if (my) return `${my[1]} ${my[2]}`;
  const y = text.match(/\b(20\d{2})\b/);
  return y ? y[1] : null;
}

// ─── Narrative ────────────────────────────────────────────────────────────────

function extractNarrative(
  c: CleanedPage,
  projects: ProjectEntry[],
): ParsedPortfolio["narrative"] {
  const sectionOrder = [
    ...new Set(
      c.textBlocks.map((b) => b.section).filter((s): s is string => s !== null),
    ),
  ];

  const structure = sectionOrder.length > 0 ? sectionOrder.join(" → ") : null;
  const fullText = allText(c.textBlocks).toLowerCase();

  const has_problem_solution_flow =
    /\b(problem|challenge|pain[- ]point)\b/.test(fullText) &&
    /\b(solution|approach|built|solved|implemented)\b/.test(fullText);

  const has_case_study_depth =
    projects.length > 0 &&
    projects.some((p) => p.stack.length > 0 && p.links.code !== null);

  const has_timeline =
    /\b(20\d{2})\b/.test(fullText) &&
    c.textBlocks.some(
      (b) => b.section === "experience" || b.section === "timeline",
    );

  return {
    structure,
    story_arc: structure
      ? `${sectionOrder[0]} → ... → ${sectionOrder[sectionOrder.length - 1]}`
      : null,
    has_problem_solution_flow,
    has_case_study_depth,
    has_timeline,
    depth_level: inferDepthLevel(c, projects),
  };
}

function inferDepthLevel(
  c: CleanedPage,
  projects: ProjectEntry[],
): "shallow" | "medium" | "deep" | null {
  const hasAbout = sectionBlocks(c.textBlocks, "about").length > 0;
  if (projects.length >= 3 && c.estimatedTextLength > 2000) return "deep";
  if (projects.length >= 2 && hasAbout && c.estimatedTextLength > 800)
    return "medium";
  if (c.estimatedTextLength < 300 || projects.length === 0) return "shallow";
  return "medium";
}

// ─── Signals ──────────────────────────────────────────────────────────────────

function buildSignals(
  identity: ParsedPortfolio["identity"],
  skills: ParsedPortfolio["skills"],
  projects: ProjectEntry[],
  proof: ProofData,
  c: CleanedPage,
): ParsedPortfolio["signals"] {
  const strong: string[] = [];
  const weak: string[] = [];
  const missing: string[] = [];
  const evidence: EvidenceEntry[] = [];

  if (identity?.name) {
    strong.push("identity:name");
    evidence.push({
      label: "name",
      text: identity.name,
      href: null,
      source: "computed",
    });
  } else {
    missing.push("identity:name");
  }

  identity?.bio_summary
    ? strong.push("identity:bio")
    : missing.push("identity:bio_summary");
  identity?.headline
    ? strong.push("identity:headline")
    : weak.push("identity:headline_missing");
  identity?.location
    ? strong.push("identity:location")
    : missing.push("identity:location");

  const sc = skills?.stack?.length ?? 0;
  if (sc > 5) strong.push(`skills:${sc}_found`);
  else if (sc > 0) weak.push(`skills:only_${sc}_found`);
  else missing.push("skills");

  if (projects.length >= 3) strong.push(`projects:${projects.length}_found`);
  else if (projects.length > 0)
    weak.push(`projects:only_${projects.length}_found`);
  else missing.push("projects");

  if (proof.github) {
    strong.push("proof:github");
    evidence.push({
      label: "github",
      text: proof.github,
      href: proof.github,
      source: "link",
    });
  } else {
    missing.push("proof:github");
  }

  if (proof.linkedin) strong.push("proof:linkedin");
  if (proof.devpost) strong.push("proof:devpost");
  if (proof.awards.length > 0)
    strong.push(`proof:awards:${proof.awards.length}`);

  if (c.metaDescription) {
    evidence.push({
      label: "metaDescription",
      text: c.metaDescription,
      href: null,
      source: "meta",
    });
  }
  if (c.title) {
    evidence.push({
      label: "title",
      text: c.title,
      href: null,
      source: "meta",
    });
  }

  return {
    strong_signals: strong,
    weak_signals: weak,
    generic_claims: [],
    missing_information: missing,
    evidence,
  };
}

// ─── Quality ──────────────────────────────────────────────────────────────────

function scoreQuality(
  id: ParsedPortfolio["identity"],
  sk: ParsedPortfolio["skills"],
  projects: ProjectEntry[],
  pf: ProofData,
): NonNullable<ParsedPortfolio["quality"]> {
  const i = r3(
    (id?.name ? 0.35 : 0) +
      (id?.headline ? 0.25 : 0) +
      (id?.bio_summary ? 0.25 : 0) +
      (id?.location ? 0.1 : 0) +
      (id?.alias ? 0.05 : 0),
  );

  // Replaced the `as any` lookup object with a clean function.
  // The original had a bug: Math.min(n, 2) always capped at index 2 (= 0.4),
  // so portfolios with 3–9 skills scored 0.4 instead of 0.7.
  const s = r3(skillsScore(sk?.stack?.length ?? 0));

  const p = r3(
    projects.length > 0
      ? Math.min(
          projects.reduce((a, x) => a + (x.confidence ?? 0), 0) /
            projects.length +
            Math.min(projects.length / 5, 1) * 0.2,
          1,
        )
      : 0,
  );

  const f = r3(
    Math.min(
      (pf.github ? 0.35 : 0) +
        (pf.linkedin ? 0.3 : 0) +
        (pf.devpost ? 0.15 : 0) +
        (pf.awards.length > 0 ? 0.2 : 0),
      1,
    ),
  );

  const o = r3(i * 0.3 + s * 0.25 + p * 0.3 + f * 0.15);

  return {
    overall_confidence: o,
    identity_confidence: i,
    skills_confidence: s,
    projects_confidence: p,
    proof_confidence: f,
    noise_level: o >= 0.65 ? "low" : o >= 0.35 ? "medium" : "high",
    extraction_risk: o >= 0.6 ? "low" : o >= 0.3 ? "medium" : "high",
  };
}

// Fixed scoring: was capped at 0.4 for any count >= 2 due to Math.min(..., 2) bug
function skillsScore(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 0.3;
  if (count < 5) return 0.5;
  if (count < 10) return 0.7;
  return 0.9;
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

function buildWarnings(
  id: ParsedPortfolio["identity"],
  sk: ParsedPortfolio["skills"],
  projects: ProjectEntry[],
  pf: ProofData,
  _c: CleanedPage,
): string[] {
  const w: string[] = [];
  if (!id?.name) w.push("Could not extract name from title, H1, or meta tags.");
  if (!id?.bio_summary)
    w.push("No bio found deterministically — Groq enrichment may fill this.");
  if (!sk?.stack?.length) w.push("No skills or technologies detected.");
  if (!projects.length)
    w.push("No project cards detected — check section labeling in cleaner.");
  if (!pf.github) w.push("No GitHub profile link found.");
  return w;
}

// ─── Gap assessment ───────────────────────────────────────────────────────────

function assessGaps(parsed: ParsedPortfolio, c: CleanedPage): ExtractionGaps {
  const aboutBlocks = sectionBlocks(c.textBlocks, "about");
  const aboutText = aboutBlocks
    .map((b) => b.text)
    .join(" ")
    .trim();
  const needsBio = !parsed.identity?.bio_summary && aboutText.length >= 100;

  const projBlocks = sectionBlocks(c.textBlocks, "projects");
  const projectSectionText = projBlocks
    .map((b) => b.text)
    .join(" ")
    .trim();

  const needsProjectNarratives =
    (parsed.projects?.length ?? 0) > 0 &&
    (parsed.projects ?? []).every((p) => !p.summary) &&
    projectSectionText.length >= 150;

  return {
    needsBio,
    aboutText: needsBio ? aboutText.slice(0, 1200) : null,
    needsProjectNarratives,
    projectSectionText: needsProjectNarratives
      ? projectSectionText.slice(0, 2000)
      : null,
    projectNames: (parsed.projects ?? [])
      .map((p) => p.name ?? "")
      .filter(Boolean),
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sectionBlocks(
  blocks: TextBlock[],
  ...sections: string[]
): TextBlock[] {
  return blocks.filter(
    (b) => b.section !== null && sections.includes(b.section),
  );
}

function allText(blocks: TextBlock[]): string {
  return blocks.map((b) => b.text).join(" ");
}

function looksLikeName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4 || text.length > 50) return false;
  return words.every((w) => /^[A-Z][a-zA-Z'\-]{0,25}$/.test(w));
}

type BlockGroup = { heading: string; body: TextBlock[] };

function groupByHeadings(blocks: TextBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let cur: BlockGroup | null = null;
  for (const b of blocks) {
    if (b.tag === "h2" || b.tag === "h3") {
      if (cur) groups.push(cur);
      cur = { heading: b.text, body: [] };
    } else if (cur) {
      cur.body.push(b);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function r3(n: number): number {
  return Math.round(Math.min(Math.max(n, 0), 1) * 1000) / 1000;
}
