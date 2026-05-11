import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { type JobHandler } from "../queue.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type IngestPortfolioPayload = {
  url: string;          // normalizedUrl
  sourceUrl?: string;
  hostname?: string;
  priority?: number;
};

function normalizePortfolioUrl(input: string): string {
  const url = new URL(input.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function getFailureMessage(code: string): string {
  switch (code) {
    case "PORTFOLIO_NOT_FOUND":
      return "This portfolio page does not exist.";
    case "PORTFOLIO_RATE_LIMIT":
      return "The site is rate limiting requests. Try again later.";
    case "PORTFOLIO_FORBIDDEN":
      return "Access to this portfolio is restricted.";
    case "PORTFOLIO_SERVER_ERROR":
      return "The portfolio site is currently experiencing issues.";
    case "NETWORK_ERROR":
      return "Network issue while contacting the portfolio site.";
    default:
      return "Unknown error occurred while ingesting portfolio.";
  }
}

async function fetchPortfolio(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "PortfolioScanner/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ingest:portfolio
 * - fetches the portfolio page
 * - validates reachability
 * - marks the record complete or failed
 * - keeps the pipeline moving deterministically
 */
export const ingestPortfolio: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { url, sourceUrl, hostname } = (job.payload || {}) as IngestPortfolioPayload;

    if (!url || typeof url !== "string") {
      return {
        success: false,
        error: "url_required",
        durationMs: Date.now() - start,
      };
    }

    const normalizedUrl = normalizePortfolioUrl(url);
    const now = Date.now();

    console.info(`[Job] ingest:portfolio — ${normalizedUrl}`);

    const existing = await PortfolioModel.findOne({ normalizedUrl });

    if (!existing) {
      await PortfolioModel.create({
        sourceUrl: sourceUrl || normalizedUrl,
        normalizedUrl,
        hostname: hostname || new URL(normalizedUrl).hostname,
        ingestionStatus: "pending",
        lastQueuedAt: new Date(),
        failure: null,
        source: "discovery",
      });
    }

    if (existing?.ingestionStatus === "running") {
      return {
        success: true,
        action: "skipped_running",
        normalizedUrl,
        durationMs: Date.now() - start,
      };
    }

    const isFresh =
      existing?.lastFetchedAt &&
      now - new Date(existing.lastFetchedAt).getTime() < DAY_MS;

    if (existing?.ingestionStatus === "complete" && isFresh) {
      return {
        success: true,
        action: "skipped_fresh",
        normalizedUrl,
        durationMs: Date.now() - start,
      };
    }

    await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          ingestionStatus: "running",
          lastQueuedAt: new Date(),
          failure: null,
        },
      },
      { upsert: true },
    );

    let res: Response;
    try {
      res = await fetchPortfolio(normalizedUrl);
    } catch (err: any) {
      const failureDoc = {
        code: "NETWORK_ERROR",
        type: "temporary" as const,
        retryAt: new Date(now + 10 * 60 * 1000),
        message: getFailureMessage("NETWORK_ERROR"),
        failedAt: new Date(),
      };

      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            ingestionStatus: "failed",
            failure: failureDoc,
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "fetch_failed",
        normalizedUrl,
        error: failureDoc.code,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }

    if (res.status === 404) {
      const failureDoc = {
        code: "PORTFOLIO_NOT_FOUND",
        type: "permanent" as const,
        retryAt: new Date(now + DAY_MS),
        message: getFailureMessage("PORTFOLIO_NOT_FOUND"),
        failedAt: new Date(),
      };

      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            ingestionStatus: "failed",
            failure: failureDoc,
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "not_found",
        normalizedUrl,
        error: failureDoc.code,
        retryable: false,
        durationMs: Date.now() - start,
      };
    }

    if (res.status === 403 || res.status === 429) {
      const failureDoc = {
        code: "PORTFOLIO_RATE_LIMIT",
        type: "temporary" as const,
        retryAt: new Date(now + 10 * 60 * 1000),
        message: getFailureMessage("PORTFOLIO_RATE_LIMIT"),
        failedAt: new Date(),
      };

      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            ingestionStatus: "failed",
            failure: failureDoc,
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "rate_limited",
        normalizedUrl,
        error: failureDoc.code,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }

    if (res.status >= 500) {
      const failureDoc = {
        code: "PORTFOLIO_SERVER_ERROR",
        type: "temporary" as const,
        retryAt: new Date(now + 5 * 60 * 1000),
        message: getFailureMessage("PORTFOLIO_SERVER_ERROR"),
        failedAt: new Date(),
      };

      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            ingestionStatus: "failed",
            failure: failureDoc,
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "server_error",
        normalizedUrl,
        error: failureDoc.code,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }

    if (!res.ok) {
      const failureDoc = {
        code: "NETWORK_ERROR",
        type: "temporary" as const,
        retryAt: new Date(now + 30 * 60 * 1000),
        message: getFailureMessage("NETWORK_ERROR"),
        failedAt: new Date(),
      };

      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            ingestionStatus: "failed",
            failure: failureDoc,
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "unknown_http_error",
        normalizedUrl,
        error: failureDoc.code,
        retryable: true,
        durationMs: Date.now() - start,
      };
    }

    await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          ingestionStatus: "complete",
          lastFetchedAt: new Date(),
          lastQueuedAt: new Date(),
          failure: null,
          sourceUrl: sourceUrl || normalizedUrl,
          hostname: hostname || new URL(normalizedUrl).hostname,
        },
      },
      { upsert: true },
    );

    return {
      success: true,
      action: "ingested",
      normalizedUrl,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    console.error("[Job] ingest:portfolio failed:", error);

    return {
      success: false,
      error: error?.message || "ingest_portfolio_failed",
      retryable: error?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};