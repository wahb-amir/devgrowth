import { PortfolioModel } from "../../db/models/portfolio.model.js";
import { normalizePortfolioUrl } from "../../lib/normalizeSource.js";
import { jobQueue, type JobHandler } from "../queue.js";
import { fetchHtmlLimited } from "./fetcher.js";
import { validateSafePortfolioUrl } from "./security.js";
import { buildPortfolioDraft } from "./parser.js";

type ParsePortfolioCollectJob = {
  name: "parse:portfolio:collect";
  url: string;
  sourceUrl?: string;
  hostname?: string;
};

export const parsePortfolioCollect: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { url, sourceUrl, hostname } = (job.payload ||
      {}) as ParsePortfolioCollectJob;
    if (!url || typeof url !== "string") {
      return {
        success: false,
        error: "url_required",
        durationMs: Date.now() - start,
      };
    }

    const normalizedUrl = normalizePortfolioUrl(url);
    const safeUrl = await validateSafePortfolioUrl(normalizedUrl);

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
        durationMs: Date.now() - start,
      };
    }

    await PortfolioModel.updateOne(
      { normalizedUrl },
      {
        $set: {
          parseStatus: "running",
          parseFailure: null,
          lastQueuedAt: new Date(),
        },
      },
    );

    const { html, finalUrl, bytes } = await fetchHtmlLimited(
      safeUrl.toString(),
    );
    const draft = buildPortfolioDraft(html);

    await jobQueue.enqueue(
      {
        name: "parse:portfolio:store",
        payload: {
          normalizedUrl,
          sourceUrl: sourceUrl || normalizedUrl,
          hostname: hostname || new URL(finalUrl).hostname,
          bytes,
          draft,
        },
      },
      2,
    );

    return {
      success: true,
      action: "collected",
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const status = err?.status ?? null;
    const retryable =
      err?.retryable ?? (status >= 500 || status === 429 || status === 403);

    return {
      success: false,
      error: err?.message || "parse_portfolio_collect_failed",
      retryable,
      statusCode: status || undefined,
      durationMs: Date.now() - start,
    };
  }
};
