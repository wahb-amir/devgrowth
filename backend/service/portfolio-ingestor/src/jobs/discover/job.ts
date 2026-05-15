import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { jobQueue, type JobHandler } from "../queue.js";
import { normalizeSource } from "../../lib/normalizeSource.js";
import { enqueueTracked } from "../TrackedEnqueue.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------------- TYPES ---------------- */

type DiscoverPortfolioPayload = {
  url: string;
  source?: "manual" | "search" | "import" | "discovery" | "user";
};

/* ---------------- HELPERS ---------------- */

function normalizePortfolioUrl(input: string): {
  sourceUrl: string;
  normalizedUrl: string;
  hostname: string;
} {
  const url = new URL(input.trim());

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return {
    sourceUrl: input.trim(),
    normalizedUrl: url.toString(),
    hostname: url.hostname,
  };
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
    case "INVALID_URL":
      return "The provided URL is not valid.";
    default:
      return "Unknown error occurred while discovering portfolio.";
  }
}

/* ---------------- JOB ---------------- */

/**
 * discover:portfolio
 * - normalizes and registers a portfolio URL
 * - skips fresh or already-processing jobs
 * - prepares the record for ingestion
 * - passes data to ingest:portfolio
 */
export const discoverPortfolio: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { url, source } = (job.payload || {}) as DiscoverPortfolioPayload;

    if (!url || typeof url !== "string") {
      return {
        success: false,
        error: "url_required",
        durationMs: Date.now() - start,
      };
    }

    let normalized;
    try {
      normalized = normalizePortfolioUrl(url);
    } catch {
      return {
        success: false,
        error: "invalid_url",
        durationMs: Date.now() - start,
      };
    }

    const { sourceUrl, normalizedUrl, hostname } = normalized;

    console.info(`[Job] discover:portfolio — ${normalizedUrl}`);

    const existing = await PortfolioModel.findOne({
      normalizedUrl,
    });

    const now = Date.now();

    /* ---------------- CASE A — already processing ---------------- */
    if (existing?.ingestionStatus === "running") {
      return {
        success: true,
        action: "skipped_running",
        normalizedUrl,
        durationMs: Date.now() - start,
      };
    }

    if (existing?.ingestionStatus === "pending") {
      return {
        success: true,
        action: "skipped_pending",
        normalizedUrl,
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- CASE B — fresh complete ---------------- */
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

    /* ---------------- OPTIONAL: preserve failure cooldown ---------------- */
    if (existing?.failure?.retryAt) {
      const retryAt = new Date(existing.failure.retryAt).getTime();

      if (now < retryAt) {
        return {
          success: true,
          action: "skipped_retry_cooldown",
          normalizedUrl,
          error: existing.failure.code,
          retryAt: existing.failure.retryAt,
          durationMs: Date.now() - start,
        };
      }
    }

    /* ---------------- UPSERT DISCOVERY STATE ---------------- */
    if (existing) {
      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            sourceUrl,
            hostname,
            ingestionStatus: "pending",
            failure: null,
            lastQueuedAt: new Date(),
          },
        },
      );
    } else {
      await PortfolioModel.create({
        sourceUrl,
        normalizedUrl,
        hostname,
        ingestionStatus: "pending",
        failure: null,
        lastQueuedAt: new Date(),
        source: normalizeSource(source),
      });
    }

    /* ---------------- QUEUE INGEST ---------------- */
    await enqueueTracked(
      {
        name: "ingest:portfolio",
        payload: {
          url: normalizedUrl,
          sourceUrl,
          hostname,
          priority: source === "manual" ? 10 : 5,
        },
       },
      {
        developerId: normalizedUrl, 
        source: source || "discovery",
        metadata: { url: normalizedUrl, source: source || "discovery" },
       },
     );

    return {
      success: true,
      action: "queued_ingest",
      normalizedUrl,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    console.error("[Job] discover:portfolio failed:", error);

    return {
      success: false,
      error: error?.message || "discover_portfolio_failed",
      retryable: error?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};
