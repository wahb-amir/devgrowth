import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PortfolioModel } from "../db/models/portfolio.model.js";
import { jobQueue } from "../jobs/queue.js";
import { normalizeSource } from "../lib/normalizeSource.js";
import { enqueueTracked } from "../jobs/TrackedEnqueue.js";

export type Portfolio = {
  sourceUrl: string;
  normalizedUrl: string;
  hostname: string;

  ingestionStatus: "pending" | "running" | "complete" | "failed";
  lastFetchedAt?: Date | null;
  failure?: {
    code: string;
    type: "temporary" | "permanent";
    message: string;
    retryAt?: Date | null;
  } | null;
};

const portfolioUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url({ message: "Invalid portfolio URL format" })
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Portfolio URL must use http or https");

type DiscoverBody = {
  url: string;
};

function normalizePortfolioUrl(input: string): {
  sourceUrl: string;
  normalizedUrl: string;
  hostname: string;
} {
  const url = new URL(input.trim());

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // Remove fragment, keep query because some portfolios use it for routing.
  url.hash = "";

  // Remove trailing slash except for root
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
      return "Unknown error occurred while fetching portfolio.";
  }
}

export async function portfolioRoutes(fastify: FastifyInstance) {
  // POST /portfolio/discover
  fastify.post<{ Body: DiscoverBody }>(
    "/portfolio/discover",
    async (request, reply) => {
      const parsed = portfolioUrlSchema.safeParse(request.body.url);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_url",
          message: parsed.error.issues[0]?.message ?? "Invalid URL",
        });
      }

      const { sourceUrl, normalizedUrl, hostname } = normalizePortfolioUrl(
        parsed.data,
      );

      const now = Date.now();

      /* ---------------- DB LOOKUP ---------------- */
      const existing = await PortfolioModel.findOne({ normalizedUrl }).lean();

      /* ---------------- 1. FRESH FAILURE CHECK ---------------- */
      if (existing?.failure?.retryAt) {
        const retryAt = new Date(existing.failure.retryAt).getTime();

        if (now < retryAt) {
          const isPermanent = existing.failure.code === "PORTFOLIO_NOT_FOUND";

          return reply.status(isPermanent ? 410 : 429).send({
            success: false,
            error: {
              code: existing.failure.code,
              type: isPermanent ? "permanent" : "temporary",
              message: getFailureMessage(existing.failure.code),
              retryAt: existing.failure.retryAt,
            },
            normalizedUrl,
            hostname,
          });
        }
      }

      /* ---------------- 2. EXISTING COMPLETE CHECK ---------------- */
      if (
        existing &&
        existing.ingestionStatus === "complete" &&
        existing.lastFetchedAt &&
        existing.lastFetchedAt <= new Date(Date.now() - 24 * 60 * 60 * 1000)
      ) {
        return reply.send({
          status: "existing",
          portfolio: existing,
          message: `${normalizedUrl} is already indexed.`,
        });
      }

      /* ---------------- 3. ENQUEUE JOB ---------------- */
      enqueueTracked(
        {
          name: "discover:portfolio",
          payload: {
            url: normalizedUrl,
            sourceUrl,
            hostname,
            source: normalizeSource("user"),
          },
        },
        {
          actorId: normalizedUrl,
          actorType: "portfolio",
          source: "portfolio",
        },
      );

      return reply.status(202).send({
        status: "queued",
        normalizedUrl,
        hostname,
        message: `Discovery job queued for ${normalizedUrl}. Portfolio will be available shortly.`,
      });
    },
  );

  // GET /portfolios/by-url?url=https://example.com
  fastify.get<{ Querystring: { url: string } }>(
    "/portfolios/by-url",
    async (request, reply) => {
      const parsed = portfolioUrlSchema.safeParse(request.query.url);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_url",
          message: parsed.error.issues[0]?.message ?? "Invalid URL",
        });
      }

      const { normalizedUrl } = normalizePortfolioUrl(parsed.data);

      const portfolio = await PortfolioModel.findOne({
        normalizedUrl,
      }).lean<Portfolio>();

      if (!portfolio) {
        return reply.status(404).send({
          error: "not_found",
          message: `${normalizedUrl} has not been indexed yet. POST /portfolios/discover to index it.`,
        });
      }

      if (
        portfolio.ingestionStatus === "pending" ||
        portfolio.ingestionStatus === "running"
      ) {
        return reply.status(202).send({
          status: portfolio.ingestionStatus,
          normalizedUrl,
          message: `Portfolio for ${normalizedUrl} is being indexed. Check back shortly.`,
        });
      }

      return reply.send({ portfolio });
    },
  );
}
