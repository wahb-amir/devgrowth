import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { extractVisibleBlocks, removeNoise } from "./cleaner.js";

export type EvidenceSnippet = {
  label: string;
  text: string;
  href?: string | null;
  source: "visible" | "meta" | "link" | "computed";
};

export type PortfolioDraft = {
  pageTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  contentHash: string;
  parsed: {
    identity: {
      name: string | null;
      alias: string | null;
      headline: string | null;
      bio_summary: string | null;
      location: string | null;
      canonical_identity: string | null;
    };
    positioning: {
      primary_positioning: string | null;
      secondary_positioning: string[];
      self_image_keywords: string[];
      tone: string | null;
      assertiveness: "low" | "medium" | "high" | null;
    };
    skills: {
      claimed: string[];
      stack: string[];
      categories: {
        frontend: string[];
        backend: string[];
        ai_ml: string[];
        databases: string[];
        devops: string[];
        other: string[];
      };
    };
    projects: Array<{
      name: string | null;
      type: string | null;
      summary: string | null;
      problem: string | null;
      approach: string | null;
      impact: string | null;
      role: string | null;
      stack: string[];
      status: string | null;
      date: string | null;
      links: {
        live_demo: string | null;
        code: string | null;
        case_study: string | null;
        other: string[];
      };
      confidence: number;
    }>;
    proof: {
      github: string | null;
      linkedin: string | null;
      devpost: string | null;
      other_profiles: string[];
      awards: Array<{
        title: string | null;
        event: string | null;
        year: string | null;
        evidence: string | null;
      }>;
      demos: string[];
      publications: string[];
      canons: string[];
    };
    narrative: {
      structure: string | null;
      story_arc: string | null;
      has_problem_solution_flow: boolean | null;
      has_case_study_depth: boolean | null;
      has_timeline: boolean | null;
      depth_level: "shallow" | "medium" | "deep" | null;
    };
    signals: {
      strong_signals: string[];
      weak_signals: string[];
      generic_claims: string[];
      missing_information: string[];
      evidence: EvidenceSnippet[];
    };
    quality: {
      overall_confidence: number;
      identity_confidence: number;
      skills_confidence: number;
      projects_confidence: number;
      proof_confidence: number;
      noise_level: "low" | "medium" | "high";
      extraction_risk: "low" | "medium" | "high";
    };
    warnings: string[];
  };
};

const STOP_WORDS = new Set([
  "home",
  "about",
  "projects",
  "project",
  "skills",
  "skill",
  "experience",
  "contact",
  "resume",
  "cv",
  "blog",
  "read more",
  "learn more",
  "view",
  "demo",
  "code",
  "live",
  "selected work",
  "featured work",
]);

const TECH_NORMALIZATION: Record<string, string> = {
  js: "JavaScript",
  ts: "TypeScript",
  nextjs: "Next.js",
  "next.js": "Next.js",
  reactjs: "React",
  "react.js": "React",
  node: "Node.js",
  nodejs: "Node.js",
  expressjs: "Express",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mongo: "MongoDB",
  mongodb: "MongoDB",
  tailwindcss: "Tailwind CSS",
  tailwind: "Tailwind CSS",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  llm: "LLM",
  ai: "AI",
  ml: "ML",
  api: "API",
  sql: "SQL",
  prisma: "Prisma",
  docker: "Docker",
  kubernetes: "Kubernetes",
  aws: "AWS",
  gcp: "GCP",
  vercel: "Vercel",
  supabase: "Supabase",
  firebase: "Firebase",
  langchain: "LangChain",
  huggingface: "Hugging Face",
};

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(String(value ?? ""));
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeTechToken(token: string): string {
  const key = token.trim().toLowerCase();
  return TECH_NORMALIZATION[key] || token.trim();
}

function tokenizeTech(text: string): string[] {
  return text
    .split(/[,•·|/()\[\]{}<>]+|\s{2,}/g)
    .map((t) => cleanText(t))
    .filter(Boolean)
    .filter((t) => t.length <= 40)
    .filter((t) => !STOP_WORDS.has(t.toLowerCase()))
    .map(normalizeTechToken);
}

function isLikelyTechToken(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length > 40) return false;
  if (STOP_WORDS.has(normalized.toLowerCase())) return false;
  if (/^\d+$/.test(normalized)) return false;
  return /[A-Za-z]/.test(normalized);
}

function extractCanonicalUrl($: cheerio.CheerioAPI): string | null {
  const canonical =
    $('link[rel="canonical"]').attr("href")?.trim() ||
    $('meta[property="og:url"]').attr("content")?.trim() ||
    null;
  return canonical || null;
}

function findNameCandidate(
  $: cheerio.CheerioAPI,
  title: string | null,
): string | null {
  const candidates = uniq([
    $("h1").first().text(),
    $('[class*="name"]').first().text(),
    $('[id*="name"]').first().text(),
  ]);

  for (const candidate of candidates) {
    if (candidate.length >= 2 && candidate.length <= 60) return candidate;
  }

  if (title) {
    const split = title.split(/[-|•]/).map((s) => cleanText(s));
    if (split[0] && split[0].length <= 60) return split[0];
  }

  return null;
}

function findHeadline($: cheerio.CheerioAPI): string | null {
  const candidate = uniq([
    $("h1").first().text(),
    $("header h2").first().text(),
    $('[class*="hero"] h2').first().text(),
    $("main h2").first().text(),
  ]).find((x) => x.length >= 8 && x.length <= 120);

  return candidate || null;
}

function extractLocationFromText(text: string): string | null {
  const pattern = /\b(?:based in|located in|from)\s+([A-Za-z][A-Za-z\s,'-]{1,60})/i;
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = cleanText(match[1]);
  if (value.length < 2 || value.length > 60) return null;
  return value;
}

function extractBioSummary(blocks: string[]): string | null {
  const candidates = blocks.filter(
    (t) =>
      t.length >= 40 &&
      t.length <= 400 &&
      !/^(projects|skills|about|experience|contact)$/i.test(t) &&
      !/^(github|linkedin|devpost)$/i.test(t),
  );
  return candidates[0] || null;
}

function extractSkills(blocks: string[]): PortfolioDraft["parsed"]["skills"] {
  const allTokens = new Set<string>();

  for (const block of blocks) {
    if (!/skill|tech|stack|tools|framework|language/i.test(block)) continue;
    const tokens = tokenizeTech(block);
    for (const token of tokens) {
      if (isLikelyTechToken(token)) allTokens.add(normalizeTechToken(token));
    }
  }

  const stacked = uniq([...allTokens]);

  const categories = {
    frontend: uniq(
      stacked.filter((t) =>
        /react|next\.js|vue|svelte|angular|tailwind|css|html|javascript|typescript|framer motion/i.test(
          t,
        ),
      ),
    ),
    backend: uniq(
      stacked.filter((t) =>
        /node\.js|express|fastify|nest|api|graphql|rest|django|flask|ruby on rails|go|rust|java|php/i.test(
          t,
        ),
      ),
    ),
    ai_ml: uniq(
      stacked.filter((t) =>
        /llm|ai|ml|pytorch|tensorflow|hugging face|langchain|transformer|embedding|openai/i.test(
          t,
        ),
      ),
    ),
    databases: uniq(
      stacked.filter((t) =>
        /postgresql|mysql|sqlite|mongodb|redis|supabase|firebase|prisma/i.test(
          t,
        ),
      ),
    ),
    devops: uniq(
      stacked.filter((t) =>
        /docker|kubernetes|aws|gcp|vercel|netlify|ci|cd|github actions/i.test(
          t,
        ),
      ),
    ),
    other: uniq(
      stacked.filter(
        (t) =>
          !/react|next\.js|vue|svelte|angular|tailwind|css|html|javascript|typescript|framer motion|node\.js|express|fastify|nest|api|graphql|rest|django|flask|ruby on rails|go|rust|java|php|llm|ai|ml|pytorch|tensorflow|hugging face|langchain|transformer|embedding|openai|postgresql|mysql|sqlite|mongodb|redis|supabase|firebase|prisma|docker|kubernetes|aws|gcp|vercel|netlify|ci|cd|github actions/i.test(
            t,
          ),
      ),
    ),
  };

  return {
    claimed: stacked,
    stack: stacked,
    categories,
  };
}

function classifyLink(
  href: string,
  text: string,
): "live_demo" | "code" | "case_study" | "other" {
  const hrefLower = href.toLowerCase();
  const textLower = text.toLowerCase();
  if (/github|gitlab|bitbucket/.test(hrefLower) || /\bcode\b/.test(textLower))
    return "code";
  if (/demo|live|site|app|deploy|vercel|netlify/.test(hrefLower + " " + textLower))
    return "live_demo";
  if (/case|study|writeup|article|blog/.test(hrefLower + " " + textLower))
    return "case_study";
  return "other";
}

function extractProofLinks(
  $: cheerio.CheerioAPI,
): PortfolioDraft["parsed"]["proof"] {
  const anchors = $("a[href]")
    .toArray()
    .map((el) => ({
      text: cleanText($(el).text()),
      href: cleanText($(el).attr("href") || ""),
    }))
    .filter((a) => a.href);

  const github = anchors.find((a) => /github\.com/i.test(a.href))?.href || null;
  const linkedin =
    anchors.find((a) => /linkedin\.com/i.test(a.href))?.href || null;
  const devpost =
    anchors.find((a) => /devpost\.com/i.test(a.href))?.href || null;

  const other_profiles = uniq(
    anchors
      .filter(
        (a) => /github\.com|linkedin\.com|devpost\.com/.test(a.href) === false,
      )
      .map((a) => a.href)
      .filter((href) =>
        /github|linkedin|devpost|x\.com|twitter|medium|substack|behance|dribbble|notion|youtube|scholar|researchgate/i.test(
          href,
        ),
      ),
  );

  return {
    github,
    linkedin,
    devpost,
    other_profiles,
    awards: [],
    demos: uniq(
      anchors
        .filter((a) => classifyLink(a.href, a.text) === "live_demo")
        .map((a) => a.href),
    ),
    publications: uniq(
      anchors
        .filter((a) =>
          /paper|publication|scholar|doi|arxiv|research/i.test(
            a.href + " " + a.text,
          ),
        )
        .map((a) => a.href),
    ),
    canons: [],
  };
}

function looksLikeProjectCard(text: string): boolean {
  return /project|built|demo|github|case study|live|app|prototype/i.test(text);
}

function extractProjects(
  $: cheerio.CheerioAPI,
): PortfolioDraft["parsed"]["projects"] {
  const candidates: PortfolioDraft["parsed"]["projects"] = [];
  const seen = new Set<string>();

  const cardSelectors = [
    "article",
    "[class*='card']",
    "[class*='project']",
    "[class*='portfolio']",
    "section",
  ];

  const potentialCards = $(cardSelectors.join(",")).toArray().slice(0, 200);

  for (const card of potentialCards) {
    const $card = $(card);
    const title =
      cleanText($card.find("h1, h2, h3, h4").first().text()) ||
      cleanText($card.find("a").first().text()) ||
      null;

    const rawText = cleanText($card.text());
    if (!title || !looksLikeProjectCard(rawText)) continue;

    const bodyTexts = uniq(
      $card
        .find("p, li, span, small")
        .toArray()
        .map((el) => cleanText($(el).text()))
        .filter((t) => t.length >= 20),
    );

    const stackTexts = uniq(
      $card
        .find("a, span, li, small, strong, em")
        .toArray()
        .map((el) => cleanText($(el).text()))
        .flatMap(tokenizeTech)
        .filter(isLikelyTechToken),
    );

    const links = {
      live_demo: null as string | null,
      code: null as string | null,
      case_study: null as string | null,
      other: [] as string[],
    };

    $card.find("a[href]").each((_, el) => {
      const href = cleanText($(el).attr("href") || "");
      const text = cleanText($(el).text());
      if (!href) return;
      const kind = classifyLink(href, text);
      if (kind === "live_demo" && !links.live_demo) links.live_demo = href;
      else if (kind === "code" && !links.code) links.code = href;
      else if (kind === "case_study" && !links.case_study) links.case_study = href;
      else if (!links.other.includes(href)) links.other.push(href);
    });

    const summary = bodyTexts[0] || null;
    const fingerprint = [title || "", summary || "", stackTexts.join("|")].join("::").toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const confidence =
      0.45 +
      (summary ? 0.15 : 0) +
      (stackTexts.length > 0 ? 0.15 : 0) +
      ((links.live_demo || links.code || links.case_study) ? 0.15 : 0);

    candidates.push({
      name: title,
      type: null,
      summary,
      problem: null,
      approach: null,
      impact: null,
      role: null,
      stack: stackTexts.slice(0, 12),
      status: null,
      date: null,
      links,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  return candidates.slice(0, 12);
}

function extractNarrative(
  title: string | null,
  headline: string | null,
  projectsCount: number,
  skillsCount: number,
  proof: PortfolioDraft["parsed"]["proof"],
): PortfolioDraft["parsed"]["narrative"] {
  const hasTimeline = false;
  const hasCaseStudyDepth = projectsCount > 0 && proof.demos.length > 0 && skillsCount > 0;
  const hasProblemSolutionFlow = projectsCount > 0;

  let structure = "hero → bio → skills → projects → proof";
  if (projectsCount === 0) structure = "hero → bio → skills";
  if (projectsCount > 3) structure = "hero → bio → selected work → proof";

  let depth_level: "shallow" | "medium" | "deep" = "shallow";
  if (projectsCount >= 3 && proof.demos.length > 0) depth_level = "medium";
  if (projectsCount >= 4 && hasCaseStudyDepth) depth_level = "deep";

  return {
    structure,
    story_arc: headline || title || null,
    has_problem_solution_flow: hasProblemSolutionFlow,
    has_case_study_depth: hasCaseStudyDepth,
    has_timeline: hasTimeline,
    depth_level,
  };
}

function extractIdentity(
  $: cheerio.CheerioAPI,
  title: string | null,
  blocks: string[],
): PortfolioDraft["parsed"]["identity"] {
  const name = findNameCandidate($, title);
  const headline = findHeadline($);
  const canonical_identity =
    name && headline ? `${name} — ${headline}` : headline || name || null;

  const bio_summary = extractBioSummary(blocks);
  const location = blocks.map(extractLocationFromText).find(Boolean) || null;

  return {
    name,
    alias: null,
    headline,
    bio_summary,
    location,
    canonical_identity,
  };
}

function buildSignals(
  blocks: string[],
  parsed: PortfolioDraft["parsed"],
  title: string | null,
  metaDescription: string | null,
): PortfolioDraft["parsed"]["signals"] {
  const strongSignals: string[] = [];
  const weakSignals: string[] = [];
  const genericClaims: string[] = [];
  const missingInformation: string[] = [];

  if (parsed.identity.name) strongSignals.push("identity:name");
  if (parsed.identity.headline) strongSignals.push("identity:headline");
  if (parsed.skills.claimed.length > 0) strongSignals.push("skills:detected");
  if (parsed.projects.length > 0) strongSignals.push("projects:detected");
  if (parsed.proof.github || parsed.proof.linkedin || parsed.proof.devpost)
    strongSignals.push("external:profiles");
  if (parsed.narrative.depth_level === "deep") strongSignals.push("narrative:deep");

  if (!parsed.identity.location) weakSignals.push("identity:location_missing");
  if (!metaDescription) weakSignals.push("meta:missing");
  if (!title) weakSignals.push("title:missing");

  for (const block of blocks.slice(0, 80)) {
    if (/passionate developer|hardworking|problem solver|self-motivated/i.test(block)) {
      genericClaims.push(block);
    }
  }

  if (parsed.projects.length === 0) missingInformation.push("projects");
  if (!parsed.proof.github && !parsed.proof.linkedin && !parsed.proof.devpost)
    missingInformation.push("external profiles");
  if (!parsed.identity.bio_summary) missingInformation.push("bio summary");
  if (parsed.projects.length > 0 && parsed.projects.every((p) => !p.impact))
    missingInformation.push("project impact");

  return {
    strong_signals: uniq(strongSignals),
    weak_signals: uniq(weakSignals),
    generic_claims: uniq(genericClaims).slice(0, 10),
    missing_information: uniq(missingInformation),
    evidence: [
      ...(title ? [{ label: "title", text: title, source: "meta" as const }] : []),
      ...(metaDescription
        ? [{ label: "metaDescription", text: metaDescription, source: "meta" as const }]
        : []),
      ...(parsed.identity.name
        ? [{ label: "name", text: parsed.identity.name, source: "computed" as const }]
        : []),
      ...(parsed.identity.headline
        ? [{ label: "headline", text: parsed.identity.headline, source: "computed" as const }]
        : []),
    ],
  };
}

function scoreQuality(
  parsed: PortfolioDraft["parsed"],
): PortfolioDraft["parsed"]["quality"] {
  const identityConfidence =
    (parsed.identity.name ? 0.35 : 0) +
    (parsed.identity.headline ? 0.25 : 0) +
    (parsed.identity.bio_summary ? 0.2 : 0) +
    (parsed.identity.location ? 0.1 : 0);

  const skillsConfidence = Math.min(
    0.9,
    parsed.skills.claimed.length > 0
      ? 0.4 + Math.min(0.5, parsed.skills.claimed.length / 20)
      : 0.1,
  );

  const projectsConfidence = Math.min(
    0.95,
    parsed.projects.length > 0
      ? 0.4 + Math.min(0.55, parsed.projects.length / 8)
      : 0.1,
  );

  const proofConfidence =
    (parsed.proof.github ? 0.25 : 0) +
    (parsed.proof.linkedin ? 0.2 : 0) +
    (parsed.proof.devpost ? 0.2 : 0) +
    (parsed.proof.demos.length > 0 ? 0.15 : 0);

  const overall =
    0.35 * identityConfidence +
    0.2 * skillsConfidence +
    0.25 * projectsConfidence +
    0.2 * proofConfidence;

  const noise_level: "low" | "medium" | "high" =
    parsed.projects.length >= 3 && parsed.skills.claimed.length >= 6
      ? "low"
      : parsed.projects.length > 0
        ? "medium"
        : "high";

  const extraction_risk: "low" | "medium" | "high" =
    parsed.identity.name && parsed.projects.length > 0
      ? "low"
      : parsed.projects.length > 0
        ? "medium"
        : "high";

  return {
    overall_confidence: Math.max(0, Math.min(1, overall)),
    identity_confidence: Math.max(0, Math.min(1, identityConfidence)),
    skills_confidence: Math.max(0, Math.min(1, skillsConfidence)),
    projects_confidence: Math.max(0, Math.min(1, projectsConfidence)),
    proof_confidence: Math.max(0, Math.min(1, proofConfidence)),
    noise_level,
    extraction_risk,
  };
}

export function buildPortfolioDraft(html: string): PortfolioDraft {
  const $ = cheerio.load(html);

  removeNoise($);

  const pageTitle = cleanText($("title").first().text()) || null;
  const metaDescription =
    cleanText($('meta[name="description"]').attr("content") || "") || null;
  const canonicalUrl = extractCanonicalUrl($);

  const blocks = extractVisibleBlocks($);
  const identity = extractIdentity($, pageTitle, blocks);
  const skills = extractSkills(blocks);
  const proof = extractProofLinks($);
  const projects = extractProjects($);
  const narrative = extractNarrative(
    pageTitle,
    identity.headline,
    projects.length,
    skills.claimed.length,
    proof,
  );

  const parsed: PortfolioDraft["parsed"] = {
    identity,
    positioning: {
      primary_positioning: identity.headline,
      secondary_positioning: uniq(
        [
          /full[- ]stack/i.test(identity.headline || "")
            ? "full-stack engineer"
            : null,
          /ai|ml|llm/i.test(blocks.join(" ")) ? "AI builder" : null,
          /product/i.test(blocks.join(" ")) ? "product engineer" : null,
        ].filter(Boolean) as string[],
      ),
      self_image_keywords: uniq([
        ...tokenizeTech(blocks.join(" ")).slice(0, 8),
        ...(identity.headline ? identity.headline.split(/\s+/).slice(0, 8) : []),
      ]).slice(0, 12),
      tone: blocks.some((b) => /ship|build|launch|craft|design/i.test(b))
        ? "builder"
        : "neutral",
      assertiveness:
        projects.length > 0 && skills.claimed.length > 5 ? "high" : "medium",
    },
    skills,
    projects,
    proof,
    narrative,
    signals: {
      strong_signals: [],
      weak_signals: [],
      generic_claims: [],
      missing_information: [],
      evidence: [],
    },
    quality: {
      overall_confidence: 0,
      identity_confidence: 0,
      skills_confidence: 0,
      projects_confidence: 0,
      proof_confidence: 0,
      noise_level: "medium",
      extraction_risk: "medium",
    },
    warnings: [],
  };

  parsed.signals = buildSignals(blocks, parsed, pageTitle, metaDescription);
  parsed.quality = scoreQuality(parsed);

  const warnings: string[] = [];
  if (!parsed.identity.name) warnings.push("No explicit developer name found.");
  if (!parsed.projects.length) warnings.push("No high-confidence project cards found.");
  if (!parsed.proof.github && !parsed.proof.linkedin && !parsed.proof.devpost)
    warnings.push("No strong external proof links found.");
  if (blocks.length > 250) warnings.push("Page is noisy; extraction confidence reduced.");
  if (!canonicalUrl) warnings.push("No canonical URL detected.");
  if (parsed.projects.length > 0 && parsed.projects.every((p) => p.summary === null)) {
    warnings.push("Project cards detected, but summaries were weak.");
  }

  return {
    pageTitle,
    metaDescription,
    canonicalUrl,
    contentHash: sha256(
      [pageTitle, metaDescription, canonicalUrl, blocks.slice(0, 120).join("\n")].join("\n---\n"),
    ),
    parsed: {
      ...parsed,
      warnings,
    },
  };
}