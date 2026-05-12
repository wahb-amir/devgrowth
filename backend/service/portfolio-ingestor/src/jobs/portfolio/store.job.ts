import { PortfolioModel } from "../../db/models/portfolio.model.js";
import type { JobHandler } from "../queue.js";

type ParsePortfolioStoreJob = {
  name: "parse:portfolio:store";
  normalizedUrl: string;
  sourceUrl?: string;
  hostname?: string;
  bytes?: number;
  draft: {
    pageTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
    contentHash: string;
    parsed: any;
  };
};

export const parsePortfolioStore: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { normalizedUrl, sourceUrl, hostname, draft, bytes } = (job.payload ||
      {}) as ParsePortfolioStoreJob;
    if (!normalizedUrl || typeof normalizedUrl !== "string") {
      return {
        success: false,
        error: "normalizedUrl_required",
        durationMs: Date.now() - start,
      };
    }

    if (!draft || typeof draft !== "object") {
      return {
        success: false,
        error: "draft_required",
        durationMs: Date.now() - start,
      };
    }

    const existing = await PortfolioModel.findOne({ normalizedUrl }).lean();

    if (existing?.contentHash && existing.contentHash === draft.contentHash) {
      await PortfolioModel.updateOne(
        { normalizedUrl },
        {
          $set: {
            parseStatus: "complete",
            parsedAt: new Date(),
            parseFailure: null,
            lastFetchedAt: new Date(),
          },
        },
      );

      return {
        success: true,
        action: "unchanged_skip",
        durationMs: Date.now() - start,
      };
    }

    const update = await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          sourceUrl: sourceUrl || normalizedUrl,
          hostname: hostname || new URL(normalizedUrl).hostname,
          parseStatus: "complete",
          parsedAt: new Date(),
          parseFailure: null,
          pageTitle: draft.pageTitle || null,
          metaDescription: draft.metaDescription || null,
          canonicalUrl: draft.canonicalUrl || null,
          contentHash: draft.contentHash || null,
          parsed: draft.parsed,
          lastFetchedAt: new Date(),
        },
      },
      { upsert: false },
    );

    if (update.matchedCount === 0) {
      return {
        success: false,
        error: "portfolio_not_found",
        durationMs: Date.now() - start,
      };
    }

    return {
      success: true,
      action: "stored",
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "parse_portfolio_store_failed",
      retryable: err?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};
