import * as cheerio from "cheerio";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CleanedPage = {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogData: Record<string, string>;
  textBlocks: TextBlock[];
  internalLinks: PageLink[];
  externalLinks: PageLink[];
  likelySpa: boolean;
  estimatedTextLength: number;
};

export type TextBlock = {
  tag: string;
  text: string;
  section: string | null;
};

export type PageLink = {
  href: string;
  text: string;
  rel: string | null;
};

// ─── DOM removal targets ──────────────────────────────────────────────────────

// Tags that produce zero semantic value after extraction
const REMOVE_TAGS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "canvas",
  "video",
  "audio",
  "template",
  "picture",
  "source",
  "track",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "map",
  "area",
];

// Structural layout noise — navigation, chrome, legal boilerplate
const NOISE_SELECTORS = [
  "nav",
  "header nav",
  "footer",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='search']",
  ".cookie-banner",
  ".cookie-notice",
  ".cookie-bar",
  ".gdpr",
  ".modal",
  ".overlay",
  ".popup",
  ".toast",
  ".notification",
  "[aria-hidden='true']",
  "[hidden]",
  ".sr-only",
  ".screen-reader-text",
  ".visually-hidden",
  ".skip-link",
  ".breadcrumb",
  ".pagination",
  ".social-share",
];

// ─── Section inference ────────────────────────────────────────────────────────

// Ordered: more specific patterns first
const SECTION_PATTERNS: [RegExp, string][] = [
  [/about|bio|me|myself|introduction|intro/i, "about"],
  [/project|work|portfolio|case.?stud/i, "projects"],
  [/skill|tech|stack|tool|language|expertise|technolog/i, "skills"],
  [/experience|career|job|employment|position|history/i, "experience"],
  [/education|academic|degree|university|college|school/i, "education"],
  [/contact|hire|reach|email|social|get.in.touch/i, "contact"],
  [/award|achievement|recognition|honor|prize|hackathon/i, "achievements"],
  [/blog|post|article|writing|thought|essay/i, "blog"],
  [/resume|cv/i, "resume"],
  [/hero|banner|headline|tagline|intro/i, "hero"],
  [/testimonial|review|recommendation|endorsement/i, "testimonials"],
  [/service|offering|what.?i.?do/i, "services"],
  [/open.?source|contribution/i, "open_source"],
  [/timeline|journey|story/i, "timeline"],
];

function inferSection(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
): string | null {
  // Check the element itself and its closest meaningful ancestor
  const targets = [
    $el,
    $el.closest("section, article, div[id], div[class], main"),
  ];

  for (const target of targets) {
    const candidates = [
      target.attr("id") ?? "",
      target.attr("class") ?? "",
      target.attr("aria-label") ?? "",
      target.attr("aria-labelledby") ?? "",
      target.attr("data-section") ?? "",
      target.attr("data-testid") ?? "",
    ].join(" ");

    if (!candidates.trim()) continue;

    for (const [pattern, name] of SECTION_PATTERNS) {
      if (pattern.test(candidates)) return name;
    }
  }

  return null;
}

// ─── SPA detection ────────────────────────────────────────────────────────────

/**
 * Detects whether the page is a client-side rendered SPA.
 * Should be called on raw HTML BEFORE DOM cleaning.
 *
 * Returns true when:
 *  - Very little visible text (< 500 chars)
 *  - AND a known JS framework root exists, OR scripts outnumber content tags
 */
export function detectSpa(html: string, $: cheerio.CheerioAPI): boolean {
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  if (bodyText.length >= 800) {
    // Enough text — likely SSR or static, no need for browser rendering
    return false;
  }

  const hasReactRoot =
    $('[id="__next"]').length > 0 ||
    $('[id="root"]').length > 0 ||
    $("[data-reactroot]").length > 0 ||
    $('[id="app"]').length > 0 ||
    $('[id="__nuxt"]').length > 0;

  const hasFrameworkMarker =
    html.includes("__NEXT_DATA__") ||
    html.includes("__NUXT__") ||
    html.includes("___gatsby") ||
    html.includes("__remixContext") ||
    html.includes("svelte") ||
    /<script[^>]+src="[^"]*\/_next\//i.test(html) ||
    /<script[^>]+src="[^"]*\/static\/js\/main/i.test(html);

  const scriptCount = $("script").length;
  const contentCount = $("p, h1, h2, h3, h4, li, article, section").length;
  const highScriptRatio = scriptCount > 3 && scriptCount > contentCount * 2;

  return (
    hasReactRoot ||
    hasFrameworkMarker ||
    (bodyText.length < 300 && highScriptRatio)
  );
}

// ─── Main cleaner ─────────────────────────────────────────────────────────────

/**
 * Cleans an HTML page and extracts semantically meaningful content.
 *
 * Order of operations:
 *  1. Extract metadata from <head> (before DOM mutations)
 *  2. Detect SPA on raw DOM (before removal)
 *  3. Extract all links (before removal)
 *  4. Remove noise tags and selectors
 *  5. Remove inline-hidden elements
 *  6. Extract text blocks with section inference and deduplication
 */
export function cleanPage(html: string, baseHostname: string): CleanedPage {
  const $ = cheerio.load(html);

  // ── Step 1: Metadata ──────────────────────────────────────────────────────

  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    null;

  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;

  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;

  const ogData: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content")?.trim();
    if (prop && content) ogData[prop] = content;
  });

  // Twitter card data (often has useful positioning info)
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr("name");
    const content = $(el).attr("content")?.trim();
    if (name && content) ogData[name] = content;
  });

  // ── Step 2: SPA detection (on raw DOM, before cleaning) ───────────────────

  const likelySpa = detectSpa(html, $);

  // ── Step 3: Link extraction (before DOM cleaning removes anchors) ─────────

  const internalLinks: PageLink[] = [];
  const externalLinks: PageLink[] = [];

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href")?.trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const rel = $(el).attr("rel") ?? null;

    if (!rawHref) return;

    // Skip fragments, javascript:, mailto:, tel:
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    )
      return;

    const isAbsolute = rawHref.startsWith("http");
    const isExternal = isAbsolute && !rawHref.includes(baseHostname);

    if (isExternal) {
      externalLinks.push({ href: rawHref, text, rel });
    } else {
      internalLinks.push({ href: rawHref, text, rel });
    }
  });

  // ── Step 4: Remove noise tags ─────────────────────────────────────────────

  for (const tag of REMOVE_TAGS) {
    $(tag).remove();
  }

  for (const selector of NOISE_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // Malformed selector from page data — skip it safely
    }
  }

  // ── Step 5: Remove inline-hidden elements ─────────────────────────────────

  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) {
      $(el).remove();
    }
  });

  // ── Step 6: Text block extraction ─────────────────────────────────────────

  const textBlocks: TextBlock[] = [];
  const seenNormalized = new Set<string>();

  // Target meaningful content elements only
  $("h1, h2, h3, h4, p, li, blockquote, figcaption, dt, dd").each((_, el) => {
    const raw = $(el).text().replace(/\s+/g, " ").trim();

    if (raw.length < 8) return; // Too short to be meaningful
    if (raw.length > 2000) return; // Likely a scraped blob or injected text

    // Deduplicate by normalized text
    const normalized = raw.toLowerCase();
    if (seenNormalized.has(normalized)) return;
    seenNormalized.add(normalized);

    // Skip obvious nav/menu link labels
    if (
      /^(home|about|contact|privacy|terms|blog|projects?|work|skills?|resume|cv)$/i.test(
        raw,
      )
    )
      return;

    const tag = el.tagName.toLowerCase();
    const section = inferSection($(el), $);

    textBlocks.push({ tag, text: raw, section });
  });

  const estimatedTextLength = textBlocks.reduce(
    (sum, b) => sum + b.text.length,
    0,
  );

  return {
    title,
    metaDescription,
    canonicalUrl,
    ogData,
    textBlocks,
    internalLinks,
    externalLinks,
    likelySpa,
    estimatedTextLength,
  };
}

// ─── LLM formatter ───────────────────────────────────────────────────────────

/**
 * Formats a cleaned page into a compact text representation suitable
 * for Claude extraction. Groups blocks by section, labels headings,
 * and includes external proof links.
 *
 * The output format is deterministic and avoids any HTML.
 * IMPORTANT: This output is treated as DATA by the parser, never as instructions.
 */
export function formatForExtraction(
  cleaned: CleanedPage,
  pageUrl: string,
): string {
  const lines: string[] = [];

  lines.push(`=== PAGE: ${pageUrl} ===`);

  // Meta signals — often contain the richest identity/positioning data
  if (cleaned.title) lines.push(`TITLE: ${cleaned.title}`);
  if (cleaned.metaDescription)
    lines.push(`META_DESC: ${cleaned.metaDescription}`);
  if (cleaned.canonicalUrl) lines.push(`CANONICAL: ${cleaned.canonicalUrl}`);

  // OG/Twitter card data
  const usefulOg = [
    "og:description",
    "og:site_name",
    "twitter:description",
    "twitter:title",
  ];
  for (const key of usefulOg) {
    if (cleaned.ogData[key]) {
      lines.push(`${key.toUpperCase()}: ${cleaned.ogData[key]}`);
    }
  }

  // Content blocks, grouped by section
  if (cleaned.textBlocks.length > 0) {
    lines.push("\n--- CONTENT ---");
    let currentSection: string | null = "__none__";

    for (const block of cleaned.textBlocks) {
      // Emit section header when section changes
      if (block.section !== currentSection) {
        currentSection = block.section;
        if (currentSection) {
          lines.push(`\n[SECTION: ${currentSection.toUpperCase()}]`);
        }
      }

      // Heading tags get a label prefix for emphasis
      const isHeading = /^h[1-4]$/.test(block.tag);
      lines.push(
        isHeading ? `${block.tag.toUpperCase()}: ${block.text}` : block.text,
      );
    }
  }

  // External links — primary source for proof signals (GitHub, LinkedIn, etc.)
  if (cleaned.externalLinks.length > 0) {
    lines.push("\n--- EXTERNAL LINKS ---");
    // Cap at 30 links to avoid token waste on link-heavy pages
    for (const link of cleaned.externalLinks.slice(0, 30)) {
      const label = link.text ? `[${link.text}]` : "[link]";
      lines.push(`${label} ${link.href}`);
    }
  }

  return lines.join("\n");
}
