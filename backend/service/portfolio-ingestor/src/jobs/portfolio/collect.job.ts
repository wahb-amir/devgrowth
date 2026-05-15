import type { Job, JobResult } from "../queue.js";
import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { crawlPortfolio } from "./crawler.js";
import { extractFromPage } from "./parser.js";
import { mergePortfolioPages, type PageExtraction } from "./merger.js";
import { jobQueue } from "../queue.js";
import crypto from "crypto";

// ─── Job handler ──────────────────────────────────────────────────────────────

/**
 * Stage 1 of the parse pipeline.
 *
 * Flow:
 *  1. Load portfolio record
 *  2. Multi-page crawl  (robots.txt → sitemap → seed → subpages)
 *  3. SPA detection     → hand off to rendered job if true
 *  4. Per-page extraction via deterministic + optional Groq enrichment
 *  5. Merge all extractions into a single portfolio record
 *  6. Enqueue parse:portfolio:store
 */
export async function parsePortfolioCollect(job: Job): Promise<JobResult> {
  const start = Date.now();
  const { portfolioId } = job.payload;

  if (!portfolioId) {
    return {
      success: false,
      error: "missing portfolioId",
      retryable: false,
      durationMs: 0,
    };
  }

  const portfolio = await PortfolioModel.findById(portfolioId).lean();
  if (!portfolio) {
    return {
      success: false,
      error: `Portfolio not found: ${portfolioId}`,
      retryable: false,
      durationMs: 0,
    };
  }

  const seedUrl = portfolio.normalizedUrl;

  await PortfolioModel.updateOne(
    { _id: portfolioId },
    {
      $set: {
        parseStatus: "running",
        lastQueuedAt: new Date(),
        parseFailure: null,
      },
    },
  );

  try {
    // ── Crawl ──────────────────────────────────────────────────────────────
    console.info(`[collect:${portfolioId}] Crawling: ${seedUrl}`);

    const crawlResult = await crawlPortfolio(seedUrl, {
      maxPages: 10,
      maxDepth: 2,
      maxTotalBytes: 10 * 1024 * 1024,
      maxTimeMs: 90_000,
      respectRobots: true,
    });

    logCrawlSummary(portfolioId, crawlResult.stats, crawlResult.skippedUrls);

    if (crawlResult.pages.length === 0) {
      return await failPermanent(
        portfolioId,
        "NO_PAGES_FETCHED",
        "Crawl returned zero pages",
        Date.now() - start,
      );
    }

    // ── SPA detection ──────────────────────────────────────────────────────
    const seedPage =
      crawlResult.pages.find((p) => p.source === "seed") ??
      crawlResult.pages[0];

    if (seedPage.cleaned.likelySpa) {
      console.info(
        `[collect:${portfolioId}] SPA detected — routing to rendered job`,
      );
      jobQueue.enqueue({
        name: "parse:portfolio:rendered",
        portfolioId,
        seedUrl,
        crawlMeta: {
          stats: crawlResult.stats,
          skippedUrls: crawlResult.skippedUrls,
          sitemapUrls: crawlResult.sitemapUrls,
        },
      });
      return {
        success: true,
        action: "spa_detected:enqueued_rendered",
        durationMs: Date.now() - start,
      };
    }

    // ── Extract ────────────────────────────────────────────────────────────
    const extractions: PageExtraction[] = [];
    let totalTokens = 0;
    let llmCallCount = 0;

    for (const page of crawlResult.pages) {
      console.info(`[collect:${portfolioId}] Extracting: ${page.url}`);
      try {
        // Pass CleanedPage directly — parser handles deterministic + optional Groq
        const { parsed, llmUsed, tokensUsed } = await extractFromPage(
          page.cleaned,
          page.url,
        );

        totalTokens += tokensUsed;
        if (llmUsed) llmCallCount++;

        extractions.push({ parsed, pageUrl: page.url, score: page.score });

        console.info(
          `[collect:${portfolioId}] ✓ ${page.url} ` +
            `confidence=${parsed.quality?.overall_confidence?.toFixed(3) ?? "?"} ` +
            `llm=${llmUsed} tokens=${tokensUsed}`,
        );
      } catch (err: any) {
        console.warn(`[collect:${portfolioId}] ✗ ${page.url}: ${err.message}`);
      }
    }

    console.info(
      `[collect:${portfolioId}] Extraction done: ` +
        `${extractions.length} pages, ${llmCallCount} LLM call(s), ${totalTokens} tokens`,
    );

    if (extractions.length === 0) {
      return await failTemporary(
        portfolioId,
        "ALL_EXTRACTIONS_FAILED",
        "Extraction failed on all pages",
        Date.now() - start,
      );
    }

    // ── Merge ──────────────────────────────────────────────────────────────
    const merged = mergePortfolioPages(extractions);

    const crawlWarnings = buildCrawlWarnings(crawlResult.stats);
    if (crawlWarnings.length > 0) {
      merged.warnings = [...(merged.warnings ?? []), ...crawlWarnings];
    }

    // ── Enqueue store ──────────────────────────────────────────────────────
    const contentHash = crypto
      .createHash("sha256")
      .update(seedPage.fetchResult.html)
      .digest("hex");

    jobQueue.enqueue({
      name: "parse:portfolio:store",
      portfolioId,
      parsed: merged,
      contentHash,
      pageTitle: seedPage.cleaned.title,
      metaDescription: seedPage.cleaned.metaDescription,
      canonicalUrl: seedPage.cleaned.canonicalUrl,
      renderingStrategy: "static",
      pagesProcessed: extractions.length,
      totalTokens,
    });

    return {
      success: true,
      action: `extracted:${extractions.length}_pages:enqueued_store`,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const permanent = err?.permanent === true;
    await failWithError(portfolioId, err, permanent);
    return {
      success: false,
      error: err.message,
      retryable: !permanent,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCrawlWarnings(
  stats: Awaited<ReturnType<typeof crawlPortfolio>>["stats"],
): string[] {
  const w: string[] = [];
  if (stats.budgetExhaustedReason) {
    w.push(
      `Crawl budget exhausted (${stats.budgetExhaustedReason}) — some pages may be missing`,
    );
  }
  if (!stats.robotsTxtFound) w.push("No robots.txt found");
  if (!stats.sitemapFound)
    w.push("No sitemap.xml found — discovery relied on link extraction only");
  return w;
}

function logCrawlSummary(
  id: string,
  stats: Awaited<ReturnType<typeof crawlPortfolio>>["stats"],
  skipped: Array<{ url: string; reason: string }>,
): void {
  console.info(
    `[collect:${id}] Crawl: ${stats.pagesFetched} fetched, ` +
      `${stats.pagesSkipped} skipped, ${stats.totalBytes}B, ${stats.totalTimeMs}ms`,
  );

  const counts = new Map<string, number>();
  for (const s of skipped) {
    const k = s.reason.split(":")[0];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size > 0) {
    console.info(
      `[collect:${id}] Skip reasons: ${[...counts.entries()].map(([r, n]) => `${r}×${n}`).join(", ")}`,
    );
  }
}

async function failPermanent(
  id: string,
  code: string,
  msg: string,
  durationMs: number,
): Promise<JobResult> {
  await PortfolioModel.updateOne(
    { _id: id },
    {
      $set: {
        parseStatus: "failed",
        parseFailure: {
          code,
          type: "permanent",
          message: msg,
          failedAt: new Date(),
        },
      },
    },
  );
  return { success: false, error: msg, retryable: false, durationMs };
}

async function failTemporary(
  id: string,
  code: string,
  msg: string,
  durationMs: number,
): Promise<JobResult> {
  await PortfolioModel.updateOne(
    { _id: id },
    {
      $set: {
        parseStatus: "failed",
        parseFailure: {
          code,
          type: "temporary",
          message: msg,
          failedAt: new Date(),
          retryAt: new Date(Date.now() + 5 * 60_000),
        },
      },
    },
  );
  return { success: false, error: msg, retryable: true, durationMs };
}

async function failWithError(
  id: string,
  err: any,
  permanent: boolean,
): Promise<void> {
  await PortfolioModel.updateOne(
    { _id: id },
    {
      $set: {
        parseStatus: "failed",
        parseFailure: {
          code: err?.code ?? "COLLECT_UNHANDLED_ERROR",
          type: permanent ? "permanent" : "temporary",
          message: err?.message ?? String(err),
          failedAt: new Date(),
          retryAt: permanent ? null : new Date(Date.now() + 5 * 60_000),
        },
      },
    },
  );
}
