import * as cheerio from "cheerio";
import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { normalizePortfolioUrl } from "../../lib/normalizeSource.js";
import { type JobHandler } from "../queue.js";

type ParsePortfolioPayload = {
  url: string; // normalizedUrl from discover/ingest
  sourceUrl?: string;
  hostname?: string;
};

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function collectText(
  $: cheerio.CheerioAPI,
  selectors: string[],
  maxItems = 3,
  maxLength = 5000,
): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const selector of selectors) {
    const elements = $(selector).toArray().slice(0, maxItems);

    for (const el of elements) {
      const text = cleanText($(el).text());
      if (!text) continue;
      if (seen.has(text)) continue;

      seen.add(text);
      parts.push(text);

      const joined = parts.join(" ");
      if (joined.length >= maxLength) {
        return joined.slice(0, maxLength);
      }
    }
  }

  return parts.join(" ").slice(0, maxLength);
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "PortfolioScanner/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      const err = new Error(`HTTP_${res.status}`);
      (err as any).status = res.status;
      (err as any).retryable =
        res.status >= 500 || res.status === 429 || res.status === 403;
      throw err;
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * parse:portfolio
 * - fetches HTML
 * - extracts title/meta/sections
 * - stores structured portfolio content for later intent extraction
 */
export const parsePortfolio: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { url, sourceUrl, hostname } = (job.payload ||
      {}) as ParsePortfolioPayload;

    if (!url || typeof url !== "string") {
      return {
        success: false,
        error: "url_required",
        durationMs: Date.now() - start,
      };
    }

    const normalizedUrl = normalizePortfolioUrl(url);
    const now = Date.now();

    console.info(`[Job] parse:portfolio — ${normalizedUrl}`);

    const existing = await PortfolioModel.findOne({ normalizedUrl }).lean();

    if (!existing) {
      return {
        success: false,
        error: "portfolio_not_registered",
        durationMs: Date.now() - start,
      };
    }

    if (existing.parseStatus === "running") {
      return {
        success: true,
        action: "skipped_running",
        normalizedUrl,
        durationMs: Date.now() - start,
      };
    }

    const runningResult = await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          parseStatus: "running",
          parseFailure: null,
        },
      },
    );

    console.log("[parse:portfolio] set running:", {
      matchedCount: runningResult.matchedCount,
      modifiedCount: runningResult.modifiedCount,
    });

    let html: string;
    try {
      html = await fetchHtml(normalizedUrl);
    } catch (err: any) {
      const status = err?.status ?? null;

      const failureDoc = {
        code:
          status === 403 || status === 429
            ? "PORTFOLIO_RATE_LIMIT"
            : status === 404
              ? "PORTFOLIO_NOT_FOUND"
              : status >= 500
                ? "PORTFOLIO_SERVER_ERROR"
                : "NETWORK_ERROR",
        type: status === 404 ? ("permanent" as const) : ("temporary" as const),
        message:
          status === 403 || status === 429
            ? "The site is rate limiting requests."
            : status === 404
              ? "This portfolio page does not exist."
              : status >= 500
                ? "The portfolio site is currently experiencing issues."
                : "Network issue while contacting the portfolio site.",
        retryAt:
          status === 404
            ? new Date(now + 24 * 60 * 60 * 1000)
            : new Date(now + 10 * 60 * 1000),
        failedAt: new Date(),
      };

      const failResult = await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            parseStatus: "failed",
            parseFailure: failureDoc,
          },
        },
      );

      console.log("[parse:portfolio] set failed:", {
        matchedCount: failResult.matchedCount,
        modifiedCount: failResult.modifiedCount,
      });

      return {
        success: false,
        action: "fetch_failed",
        normalizedUrl,
        error: failureDoc.code,
        retryable: failureDoc.type === "temporary",
        durationMs: Date.now() - start,
      };
    }

    const $ = cheerio.load(html);

    const pageTitle = cleanText($("title").first().text()) || null;
    const metaDescription =
      cleanText($('meta[name="description"]').attr("content") || "") || null;

    const sections = {
      hero: collectText($, [
        "header",
        ".hero",
        "[class*='hero']",
        "[id*='hero']",
      ]),
      about: collectText($, ["[id*='about']", "[class*='about']"]),
      skills: collectText($, [
        "[id*='skill']",
        "[class*='skill']",
        "[id*='tech']",
        "[class*='tech']",
      ]),
      projects: collectText($, ["[id*='project']", "[class*='project']"]),
      footer: collectText($, ["footer"]),
    };

    const completeResult = await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          parseStatus: "complete",
          parsedAt: new Date(),
          parseFailure: null,
          pageTitle,
          metaDescription,
          sections,
          sourceUrl: sourceUrl || normalizedUrl,
          hostname: hostname || new URL(normalizedUrl).hostname,
        },
      },
    );

    console.log("[parse:portfolio] set complete:", {
      matchedCount: completeResult.matchedCount,
      modifiedCount: completeResult.modifiedCount,
    });

    return {
      success: true,
      action: "parsed",
      normalizedUrl,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    console.error("[Job] parse:portfolio failed:", error);

    return {
      success: false,
      error: error?.message || "parse_portfolio_failed",
      retryable: error?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};
