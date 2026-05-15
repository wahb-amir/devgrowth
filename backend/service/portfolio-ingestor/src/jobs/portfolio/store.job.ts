import type { Job, JobResult } from "../queue.js";
import { PortfolioModel } from "../../db/models/portfolio.model.js";

// ─── Job handler ──────────────────────────────────────────────────────────────

/**
 * Stage 2 (final) of the parse pipeline.
 *
 * Responsibilities:
 *  - Receive merged parsed data from collect.job or rendered.job
 *  - Persist to MongoDB with a single idempotent updateOne
 *  - Set parserVersion to "v2" (or "v2-playwright" for rendered path)
 *  - Clear any prior parseFailure on success
 *
 * This job does NOT re-extract or modify the parsed data.
 * It is a pure persistence step.
 *
 * Idempotency: if this job is retried (e.g. MongoDB blip), running it again
 * with the same data is safe — it just overwrites with identical values.
 */
export async function parsePortfolioStore(job: Job): Promise<JobResult> {
  const start = Date.now();

  const {
    portfolioId,
    parsed,
    contentHash,
    pageTitle,
    metaDescription,
    canonicalUrl,
    renderingStrategy,
    pagesProcessed,
    totalTokens,
  } = job as unknown as {
    portfolioId: string;
    parsed: Record<string, unknown>;
    contentHash: string | null;
    pageTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
    renderingStrategy: "static" | "playwright";
    pagesProcessed?: number;
    totalTokens?: number;
  };

  // ── Input validation ───────────────────────────────────────────────────────
  if (!portfolioId) {
    return {
      success: false,
      error: "store job missing portfolioId",
      retryable: false,
      durationMs: 0,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      success: false,
      error: "store job missing or invalid parsed data",
      retryable: false,
      durationMs: 0,
    };
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  try {
    const parserVersion =
      renderingStrategy === "playwright" ? "v2-playwright" : "v2";

    const result = await PortfolioModel.updateOne(
      { _id: portfolioId },
      {
        $set: {
          parseStatus: "complete",
          parsed,
          contentHash: contentHash ?? null,
          pageTitle: pageTitle ?? null,
          metaDescription: metaDescription ?? null,
          canonicalUrl: canonicalUrl ?? null,
          parsedAt: new Date(),
          lastFetchedAt: new Date(),
          parserVersion,
          // Clear any prior failure state
          parseFailure: null,
        },
      },
    );

    if (result.matchedCount === 0) {
      // Record was deleted between collect and store — treat as permanent
      return {
        success: false,
        error: `Portfolio record not found during store: ${portfolioId}`,
        retryable: false,
        durationMs: Date.now() - start,
      };
    }

    console.info(
      `[store:${portfolioId}] ✓ Saved ` +
        `(version=${parserVersion}, ` +
        `strategy=${renderingStrategy}, ` +
        `pages=${pagesProcessed ?? "?"}, ` +
        `tokens=${totalTokens ?? "?"}, ` +
        `confidence=${(parsed as any)?.quality?.overall_confidence?.toFixed(3) ?? "?"})`,
    );

    return {
      success: true,
      action: "stored",
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    // MongoDB errors are generally retryable (transient connection issues)
    console.error(
      `[store:${portfolioId}] ✗ MongoDB write failed: ${err.message}`,
    );

    return {
      success: false,
      error: err.message,
      retryable: true, // Let the queue retry with backoff
      durationMs: Date.now() - start,
    };
  }
}
