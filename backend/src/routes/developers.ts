import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DeveloperModel } from "../db/models/index.js";
import { jobQueue } from "../jobs/queue.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------------- VALIDATION ---------------- */

const usernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/, {
    message: "Invalid GitHub username format",
  });

type DiscoverBody = {
  username: string;
};
function getFailureMessage(code: string): string {
  switch (code) {
    case "GITHUB_NOT_FOUND":
      return "This GitHub user does not exist.";

    case "GITHUB_RATE_LIMIT":
      return "GitHub rate limit exceeded. Try again later.";

    case "GITHUB_FORBIDDEN":
      return "Access to this profile is restricted.";

    case "GITHUB_SERVER_ERROR":
      return "GitHub is currently experiencing issues.";

    case "NETWORK_ERROR":
      return "Network issue while contacting GitHub.";

    default:
      return "Unknown error occurred while fetching profile.";
  }
}

/* ---------------- ROUTES ---------------- */

export async function developerRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: DiscoverBody }>(
    "/developers/discover",
    async (request, reply) => {
      const start = Date.now();

      const parsed = usernameSchema.safeParse(request.body.username);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_username",
          message: parsed.error.issues[0]?.message ?? "Invalid username",
        });
      }

      const username = parsed.data.toLowerCase();

      /* ---------------- DB LOOKUP ---------------- */

      const existing = await DeveloperModel.findOne({ username }).lean();

      const now = Date.now();

      /* ---------------- 1. FRESH CHECK ---------------- */

      if (existing?.failure?.retryAt) {
        const retryAt = new Date(existing.failure.retryAt).getTime();

        if (now < retryAt) {
          const isPermanent = existing.failure.code === "GITHUB_NOT_FOUND";

          return reply.status(isPermanent ? 410 : 429).send({
            success: false,

            error: {
              code: existing.failure.code,
              type: isPermanent ? "permanent" : "temporary",

              message: getFailureMessage(existing.failure.code),

              retryAt: existing.failure.retryAt,
            },

            username,
          });
        }
      }
    },
  );

  /* ---------------- GET ---------------- */

  fastify.get<{ Params: { username: string } }>(
    "/developers/:username",
    async (request, reply) => {
      const username = request.params.username.toLowerCase();

      const developer = await DeveloperModel.findOne({ username }).lean();

      if (!developer) {
        return reply.status(404).send({
          error: "not_found",
          message: `${username} not indexed yet.`,
        });
      }

      if (
        developer.ingestionStatus === "pending" ||
        developer.ingestionStatus === "running"
      ) {
        return reply.status(202).send({
          status: developer.ingestionStatus,
          username,
          message: "Indexing in progress.",
        });
      }

      return reply.send({ developer });
    },
  );
}
