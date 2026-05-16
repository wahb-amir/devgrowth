import type { Job, JobResult } from "../queue.js";
import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { cleanPage } from "./cleaner.js";
import { extractFromPage } from "./parser.js";
import { mergePortfolioPages, type PageExtraction } from "./merger.js";
import {
  validateUrlSyntax,
  isSameDomain,
  scorePageUrl,
  isTrapUrl,
} from "./security.js";
import { isAllowedByRobots, fetchRobotsTxt } from "./fetcher.js";
import { enqueueTracked } from "../TrackedEnqueue.js";
import crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const RENDER_TIMEOUT_MS = 20_000;
const HYDRATION_WAIT_MS = 2_500;
const MAX_SCROLL_STEPS = 20;
const SCROLL_STEP_PX = 500;
const SCROLL_STEP_DELAY_MS = 150;
const MAX_RENDERED_PAGES = 5;

const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
  "font",
  "websocket",
  "other",
]);

const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "analytics.google.com",
  "facebook.com",
  "connect.facebook.net",
  "hotjar.com",
  "amplitude.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "sentry.io",
  "bugsnag.com",
  "intercom.io",
  "crisp.chat",
  "tawk.to",
];

// ─── Job handler ──────────────────────────────────────────────────────────────

export async function parsePortfolioRendered(job: Job): Promise<JobResult> {
  const start = Date.now();
  const { portfolioId, seedUrl, crawlMeta } = job.payload as unknown as {
    portfolioId: string;
    seedUrl: string;
    crawlMeta?: {
      stats: Record<string, unknown>;
      skippedUrls: any[];
      sitemapUrls: string[];
    };
  };

  if (!portfolioId || !seedUrl) {
    return {
      success: false,
      error: "missing portfolioId or seedUrl",
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

  // Playwright is an optional dependency
  let chromium: any;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    return await failPermanent(
      portfolioId,
      "PLAYWRIGHT_NOT_INSTALLED",
      "Run: npm install playwright && npx playwright install chromium",
      Date.now() - start,
    );
  }

  const hostname = new URL(seedUrl).hostname;
  const protocol = new URL(seedUrl).protocol.replace(":", "");
  const robotsTxt = await fetchRobotsTxt(hostname, protocol);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--blink-settings=imagesEnabled=false",
    ],
  });

  try {
    // ── Render seed ────────────────────────────────────────────────────────
    console.info(`[rendered:${portfolioId}] Rendering: ${seedUrl}`);
    const seedHtml = await renderPage(browser, seedUrl);
    const seedCleaned = cleanPage(seedHtml, hostname);
    const contentHash = crypto
      .createHash("sha256")
      .update(seedHtml)
      .digest("hex");

    // ── Discover subpages from rendered DOM ────────────────────────────────
    const subCandidates = seedCleaned.internalLinks
      .map((l) => {
        try {
          return new URL(l.href, seedUrl).href;
        } catch {
          return null;
        }
      })
      .filter((u): u is string => u !== null)
      .filter((u) => {
        try {
          const p = validateUrlSyntax(u);
          return (
            isSameDomain(p, hostname) && !isTrapUrl(p) && scorePageUrl(p) >= 0.5
          );
        } catch {
          return false;
        }
      })
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, MAX_RENDERED_PAGES - 1);

    // ── Extract seed ───────────────────────────────────────────────────────
    const extractions: PageExtraction[] = [];
    let totalTokens = 0;
    let llmCallCount = 0;

    try {
      // Pass CleanedPage — same interface as static path
      const { parsed, llmUsed, tokensUsed } = await extractFromPage(
        seedCleaned,
        seedUrl,
      );
      totalTokens += tokensUsed;
      if (llmUsed) llmCallCount++;
      extractions.push({ parsed, pageUrl: seedUrl, score: 1.0 });
      console.info(
        `[rendered:${portfolioId}] ✓ Seed confidence=${parsed.quality?.overall_confidence?.toFixed(3) ?? "?"} ` +
          `llm=${llmUsed} tokens=${tokensUsed}`,
      );
    } catch (err: any) {
      console.warn(
        `[rendered:${portfolioId}] ✗ Seed extraction: ${err.message}`,
      );
    }

    // ── Extract subpages ───────────────────────────────────────────────────
    for (const subUrl of subCandidates) {
      if (
        robotsTxt &&
        !isAllowedByRobots(robotsTxt, new URL(subUrl).pathname)
      ) {
        console.info(
          `[rendered:${portfolioId}] Skipping robots.txt: ${subUrl}`,
        );
        continue;
      }

      try {
        const subHtml = await renderPage(browser, subUrl);
        const subCleaned = cleanPage(subHtml, hostname);
        const subScore = scorePageUrl(new URL(subUrl));

        const { parsed, llmUsed, tokensUsed } = await extractFromPage(
          subCleaned,
          subUrl,
        );
        totalTokens += tokensUsed;
        if (llmUsed) llmCallCount++;
        extractions.push({ parsed, pageUrl: subUrl, score: subScore });

        console.info(
          `[rendered:${portfolioId}] ✓ Sub ${subUrl} ` +
            `confidence=${parsed.quality?.overall_confidence?.toFixed(3) ?? "?"} ` +
            `llm=${llmUsed} tokens=${tokensUsed}`,
        );
      } catch (err: any) {
        console.warn(
          `[rendered:${portfolioId}] ✗ Sub ${subUrl}: ${err.message}`,
        );
      }
      await sleep(500);
    }

    console.info(
      `[rendered:${portfolioId}] Done: ${extractions.length} pages, ` +
        `${llmCallCount} LLM call(s), ${totalTokens} tokens`,
    );

    if (extractions.length === 0) {
      return await failPermanent(
        portfolioId,
        "RENDERED_NO_EXTRACTIONS",
        "Playwright rendering produced no extractable content",
        Date.now() - start,
      );
    }

    const merged = mergePortfolioPages(extractions);
    merged.warnings = [
      ...(merged.warnings ?? []),
      `Rendered via Playwright (SPA detected) — ${extractions.length} page(s) processed`,
    ];

    enqueueTracked(
      {
        name: "parse:portfolio:store",
        portfolioId,
        parsed: merged,
        contentHash,
        pageTitle: seedCleaned.title,
        metaDescription: seedCleaned.metaDescription,
        canonicalUrl: seedCleaned.canonicalUrl,
        renderingStrategy: "playwright",
        pagesProcessed: extractions.length,
        totalTokens,
      },
      {
        actorId: portfolio.developerId?.toString() ?? "unknown",
        actorType: "portfolio",
        source: "portfolio",
      },
    );

    return {
      success: true,
      action: `rendered:${extractions.length}_pages:enqueued_store`,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const permanent = err?.permanent === true;
    await PortfolioModel.updateOne(
      { _id: portfolioId },
      {
        $set: {
          parseStatus: "failed",
          parseFailure: {
            code: err?.code ?? "RENDERED_ERROR",
            type: permanent ? "permanent" : "temporary",
            message: err?.message ?? String(err),
            failedAt: new Date(),
            retryAt: permanent ? null : new Date(Date.now() + 10 * 60_000),
          },
        },
      },
    );
    return {
      success: false,
      error: err?.message ?? String(err),
      retryable: !permanent,
      durationMs: Date.now() - start,
    };
  } finally {
    await browser
      .close()
      .catch((e: any) =>
        console.error(
          `[rendered:${portfolioId}] browser.close failed: ${e.message}`,
        ),
      );
  }
}

// ─── Page renderer ────────────────────────────────────────────────────────────

async function renderPage(browser: any, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.route("**/*", async (route: any) => {
      const type: string = route.request().resourceType();
      const rUrl: string = route.request().url();
      if (
        BLOCKED_RESOURCE_TYPES.has(type) ||
        BLOCKED_DOMAINS.some((d) => rUrl.includes(d))
      ) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: RENDER_TIMEOUT_MS,
    });
    await page.waitForTimeout(HYDRATION_WAIT_MS);
    await autoScroll(page);

    const html = await page.content();
    if (!html || html.trim().length < 100) {
      throw Object.assign(new Error(`Near-empty HTML from ${url}`), {
        code: "RENDERED_EMPTY",
        permanent: false,
      });
    }
    return html;
  } finally {
    await page.close().catch(() => {});
  }
}

async function autoScroll(page: any): Promise<void> {
  await page.evaluate(
    async ({
      maxSteps,
      stepPx,
      delayMs,
    }: {
      maxSteps: number;
      stepPx: number;
      delayMs: number;
    }) => {
      await new Promise<void>((resolve) => {
        let steps = 0;
        let lastH = 0;
        const t = setInterval(() => {
          window.scrollBy(0, stepPx);
          steps++;
          const atBottom =
            window.scrollY + window.innerHeight >=
            document.body.scrollHeight - 50;
          if (
            steps >= maxSteps ||
            atBottom ||
            document.body.scrollHeight === lastH
          ) {
            clearInterval(t);
            window.scrollTo(0, 0);
            resolve();
          }
          lastH = document.body.scrollHeight;
        }, delayMs);
      });
    },
    {
      maxSteps: MAX_SCROLL_STEPS,
      stepPx: SCROLL_STEP_PX,
      delayMs: SCROLL_STEP_DELAY_MS,
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
          retryAt: null,
        },
      },
    },
  );
  return { success: false, error: msg, retryable: false, durationMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
