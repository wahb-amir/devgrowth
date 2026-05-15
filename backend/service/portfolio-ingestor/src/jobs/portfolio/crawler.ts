import {
  fetchHtml,
  fetchRobotsTxt,
  fetchSitemap,
  isAllowedByRobots,
} from "./fetcher.js";
import { cleanPage, formatForExtraction } from "./cleaner.js";
import {
  validateUrlSyntax,
  isSameDomain,
  isTrapUrl,
  scorePageUrl,
} from "./security.js";
import type { FetchResult } from "./fetcher.js";
import type { CleanedPage } from "./cleaner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CrawlBudget = {
  maxPages: number;
  maxDepth: number;
  maxTotalBytes: number;
  maxTimeMs: number;
  respectRobots: boolean;
  delayBetweenRequestsMs: number;
};

export type CrawledPage = {
  url: string;
  depth: number;
  fetchResult: FetchResult;
  cleaned: CleanedPage;
  formatted: string;
  score: number;
  source: "seed" | "sitemap" | "discovered";
};

export type SkippedUrl = {
  url: string;
  reason: string;
  depth: number;
};

export type CrawlStats = {
  pagesAttempted: number;
  pagesFetched: number;
  pagesSkipped: number;
  totalBytes: number;
  totalTimeMs: number;
  robotsTxtFound: boolean;
  sitemapFound: boolean;
  budgetExhaustedReason: string | null;
};

export type CrawlResult = {
  pages: CrawledPage[];
  skippedUrls: SkippedUrl[];
  robotsTxt: string | null;
  sitemapUrls: string[];
  stats: CrawlStats;
};

type QueueEntry = {
  url: string;
  depth: number;
  score: number;
  source: CrawledPage["source"];
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 10,
  maxDepth: 2,
  maxTotalBytes: 10 * 1024 * 1024, // 10MB total across all pages
  maxTimeMs: 90_000, // 90 seconds total
  respectRobots: true,
  delayBetweenRequestsMs: 400, // polite crawl delay
};

// ─── URL normalization ────────────────────────────────────────────────────────

/**
 * Normalizes a URL for deduplication:
 *  - Removes fragment (#section)
 *  - Removes common tracking query params
 *  - Removes trailing slash from non-root paths
 *  - Lowercases the hostname
 */
function normalizeForDedup(url: URL): string {
  const n = new URL(url.href);
  n.hash = "";
  n.hostname = n.hostname.toLowerCase();

  const trackingParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "ref",
    "referrer",
    "fbclid",
    "gclid",
    "_ga",
    "mc_cid",
  ];
  trackingParams.forEach((p) => n.searchParams.delete(p));

  // Sort remaining params for consistent dedup key
  n.searchParams.sort();

  let href = n.href;
  // Remove trailing slash from non-root paths
  if (n.pathname.length > 1 && href.endsWith("/")) {
    href = href.slice(0, -1);
  }

  return href;
}

// ─── Priority queue helper ────────────────────────────────────────────────────

function insertSorted(queue: QueueEntry[], entry: QueueEntry): void {
  // Binary insert to maintain descending score order
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (queue[mid].score >= entry.score) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  queue.splice(lo, 0, entry);
}

// ─── Main crawler ─────────────────────────────────────────────────────────────

/**
 * Crawls a portfolio website starting from a seed URL.
 *
 * Execution order:
 *  1. Validate seed URL
 *  2. Fetch robots.txt (non-blocking)
 *  3. Fetch sitemap.xml (non-blocking)
 *  4. Build initial priority queue from seed + high-value sitemap URLs
 *  5. BFS with priority: dequeue highest-score URL, fetch, clean, discover links
 *  6. Stop when budget (pages, bytes, time) is exhausted
 *
 * All fetches go through the security-validated fetcher.
 * Each discovered URL is validated, scored, and trap-checked before enqueuing.
 */
export async function crawlPortfolio(
  seedUrl: string,
  budget: Partial<CrawlBudget> = {},
): Promise<CrawlResult> {
  const limits: CrawlBudget = { ...DEFAULT_BUDGET, ...budget };
  const startTime = Date.now();

  // ── Validate seed ──────────────────────────────────────────────────────────
  const seedParsed = validateUrlSyntax(seedUrl);
  const hostname = seedParsed.hostname;
  const protocol = seedParsed.protocol.replace(":", "");

  const visited = new Set<string>();
  const skipped: SkippedUrl[] = [];
  const pages: CrawledPage[] = [];
  let totalBytes = 0;
  let pagesAttempted = 0;
  let budgetExhaustedReason: string | null = null;

  // ── Step 1: robots.txt ─────────────────────────────────────────────────────
  console.info(`[crawler] Fetching robots.txt for ${hostname}`);
  const robotsTxt = await fetchRobotsTxt(hostname, protocol);

  // ── Step 2: sitemap ────────────────────────────────────────────────────────
  console.info(`[crawler] Fetching sitemap for ${hostname}`);
  const sitemapUrls = await fetchSitemap(hostname, protocol);
  console.info(`[crawler] Found ${sitemapUrls.length} sitemap URLs`);

  // ── Step 3: Build initial priority queue ───────────────────────────────────
  const queue: QueueEntry[] = [];

  // Seed always first with max score
  queue.push({ url: seedUrl, depth: 0, score: 1.0, source: "seed" });

  // Inject high-value sitemap URLs at depth 1
  for (const sitemapUrl of sitemapUrls) {
    try {
      const parsed = validateUrlSyntax(sitemapUrl);
      if (!isSameDomain(parsed, hostname)) continue;
      if (isTrapUrl(parsed)) continue;

      const score = scorePageUrl(parsed);
      if (score < 0.35) continue; // Skip low-value sitemap entries

      insertSorted(queue, {
        url: sitemapUrl,
        depth: 1,
        score,
        source: "sitemap",
      });
    } catch {
      // Skip invalid or blocked sitemap URLs silently
    }
  }

  console.info(`[crawler] Initial queue: ${queue.length} URLs for ${hostname}`);

  // ── Step 4: Priority BFS crawl ─────────────────────────────────────────────
  while (queue.length > 0) {
    const elapsed = Date.now() - startTime;

    // Budget checks — check before dequeuing
    if (pages.length >= limits.maxPages) {
      budgetExhaustedReason = `page_limit:${limits.maxPages}`;
      break;
    }
    if (totalBytes >= limits.maxTotalBytes) {
      budgetExhaustedReason = `byte_limit:${limits.maxTotalBytes}`;
      break;
    }
    if (elapsed >= limits.maxTimeMs) {
      budgetExhaustedReason = `time_limit:${limits.maxTimeMs}ms`;
      break;
    }

    // Dequeue highest-priority entry (front of sorted queue)
    const entry = queue.shift()!;
    pagesAttempted++;

    // ── Validate and deduplicate ─────────────────────────────────────────────
    let normalizedKey: string;
    try {
      const parsedEntry = validateUrlSyntax(entry.url);
      normalizedKey = normalizeForDedup(parsedEntry);
    } catch (err: any) {
      skipped.push({
        url: entry.url,
        reason: `security: ${err.message}`,
        depth: entry.depth,
      });
      continue;
    }

    if (visited.has(normalizedKey)) {
      skipped.push({ url: entry.url, reason: "duplicate", depth: entry.depth });
      continue;
    }
    visited.add(normalizedKey);

    // ── robots.txt check ─────────────────────────────────────────────────────
    if (limits.respectRobots && robotsTxt) {
      const parsedEntry = new URL(entry.url);
      if (!isAllowedByRobots(robotsTxt, parsedEntry.pathname)) {
        skipped.push({
          url: entry.url,
          reason: "robots.txt:disallowed",
          depth: entry.depth,
        });
        continue;
      }
    }

    // ── Trap check ───────────────────────────────────────────────────────────
    try {
      if (isTrapUrl(validateUrlSyntax(entry.url))) {
        skipped.push({
          url: entry.url,
          reason: "trap_pattern",
          depth: entry.depth,
        });
        continue;
      }
    } catch {
      continue;
    }

    // ── Fetch ─────────────────────────────────────────────────────────────────
    console.info(
      `[crawler] Fetching (depth=${entry.depth}, score=${entry.score.toFixed(2)}, src=${entry.source}): ${entry.url}`,
    );

    let fetchResult: FetchResult;
    try {
      fetchResult = await fetchHtml(entry.url);
    } catch (err: any) {
      skipped.push({
        url: entry.url,
        reason: `fetch_error: ${err.message}`,
        depth: entry.depth,
      });
      continue;
    }

    totalBytes += fetchResult.byteLength;

    // ── Clean ─────────────────────────────────────────────────────────────────
    const cleaned = cleanPage(fetchResult.html, hostname);
    const formatted = formatForExtraction(cleaned, fetchResult.finalUrl);

    pages.push({
      url: fetchResult.finalUrl,
      depth: entry.depth,
      fetchResult,
      cleaned,
      formatted,
      score: entry.score,
      source: entry.source,
    });

    console.info(
      `[crawler] ✓ Page ${pages.length}/${limits.maxPages}: ${fetchResult.finalUrl} ` +
        `(${fetchResult.byteLength} bytes, spa=${cleaned.likelySpa}, text=${cleaned.estimatedTextLength})`,
    );

    // ── Discover links for next depth level ───────────────────────────────────
    if (entry.depth < limits.maxDepth) {
      for (const link of cleaned.internalLinks) {
        // Resolve relative URLs against the current page URL
        let resolvedUrl: string;
        try {
          const resolved = new URL(link.href, fetchResult.finalUrl);
          resolvedUrl = resolved.href;

          const resolvedParsed = validateUrlSyntax(resolvedUrl);
          if (!isSameDomain(resolvedParsed, hostname)) continue;
          if (isTrapUrl(resolvedParsed)) continue;

          const normalizedResolved = normalizeForDedup(resolvedParsed);
          if (visited.has(normalizedResolved)) continue;

          const score = scorePageUrl(resolvedParsed);
          if (score < 0.2) continue; // Don't queue very low-value pages

          insertSorted(queue, {
            url: resolvedUrl,
            depth: entry.depth + 1,
            score,
            source: "discovered",
          });
        } catch {
          // Invalid or blocked URL — skip
          continue;
        }
      }
    }

    // ── Polite delay ─────────────────────────────────────────────────────────
    // Skip delay for the very last page or if out of queue
    if (queue.length > 0) {
      await sleep(
        limits.delayBetweenRequestsMs + Math.floor(Math.random() * 150), // ±150ms jitter
      );
    }
  }

  const totalTimeMs = Date.now() - startTime;

  console.info(
    `[crawler] Done: ${pages.length} pages fetched, ` +
      `${skipped.length} skipped, ` +
      `${totalBytes} bytes, ` +
      `${totalTimeMs}ms` +
      (budgetExhaustedReason ? `, budget: ${budgetExhaustedReason}` : ""),
  );

  return {
    pages,
    skippedUrls: skipped,
    robotsTxt,
    sitemapUrls,
    stats: {
      pagesAttempted,
      pagesFetched: pages.length,
      pagesSkipped: skipped.length,
      totalBytes,
      totalTimeMs,
      robotsTxtFound: robotsTxt !== null,
      sitemapFound: sitemapUrls.length > 0,
      budgetExhaustedReason,
    },
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
