import type { CleanedPage } from "./cleaner.js";
import { deterministicExtract } from "./extractor.js";
import { groqEnrich } from "./enricher.js";
import { ParsedPortfolio } from "./types.js";
// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtractionResult = {
  parsed: ParsedPortfolio;
  llmUsed: boolean;
  tokensUsed: number;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Primary extraction pipeline for a single crawled page.
 *
 * Execution order:
 *  1. Deterministic extractor  — covers ~95% of structured fields
 *     (name, headline, skills, proof, projects, signals, quality)
 *  2. Gap assessment           — identifies what determinism couldn't fill
 *  3. Groq enrichment          — targeted call for bio + project narratives ONLY
 *     Skipped entirely if:
 *       - GROQ_API_KEY not set
 *       - No gaps exist (deterministic got everything)
 *       - Not enough section text to send Groq anything useful
 *
 * Input:  CleanedPage (structured DOM output from cleaner.ts)
 * Output: ParsedPortfolio + observability metadata
 */
export async function extractFromPage(
  cleaned: CleanedPage,
  pageUrl: string,
): Promise<ExtractionResult> {
  // ── Step 1: Deterministic pass ────────────────────────────────────────────
  const { parsed: partial, gaps } = deterministicExtract(cleaned, pageUrl);

  // ── Step 2: Groq enrichment for gaps only ─────────────────────────────────
  const { parsed, tokensUsed, skipped, skipReason } = await groqEnrich(
    partial,
    gaps,
  );

  if (skipped && skipReason && skipReason !== "no gaps requiring enrichment") {
    // Log only non-trivial skips (not "no gaps" — that's the happy path)
    console.info(`[parser] Enrichment skipped (${pageUrl}): ${skipReason}`);
  }

  return {
    parsed,
    llmUsed: !skipped,
    tokensUsed,
  };
}
