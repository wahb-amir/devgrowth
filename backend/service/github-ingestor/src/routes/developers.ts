import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DeveloperModel } from "../db/models/index.js";
import { verifyInternalToken } from "../hooks/auth.js";
import { enqueueTracked } from "../jobs/TrackedEnqueue.js";

export type Developer = {
  githubId: number;
  username: string;
  ingestionStatus: "pending" | "running" | "complete" | "failed";
  lastFetchedAt?: Date | null;
};

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

export async function developerRoutes(fastify: FastifyInstance) {
  // Attaching the auth hook to all routes in this file to enforce internal token verification
  fastify.addHook('preHandler', verifyInternalToken);


  // POST /developers/discover
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
      if (
        existing &&
        existing.ingestionStatus === "complete" &&
        existing.lastFetchedAt &&
        existing.lastFetchedAt <= new Date(Date.now() - 24 * 60 * 60 * 1000)
      ) {
        return reply.send({
          status: "existing",
          developer: existing,
          message: `${username} is already indexed.`,
        });
      }

      enqueueTracked(
        {
          name: "discover:developer",
          payload: { username, source: "search" },
        },
        {
          actorId: username,
          actorType: "developer",
          source: "search"
        },
      );

      return reply.status(202).send({
        status: "queued",
        username,
        message: `Discovery job queued for ${username}. Profile will be available shortly.`,
      });
    },
  );

  // GET /developers/:username
  fastify.get<{ Params: { username: string } }>(
    "/developers/:username",
    async (request, reply) => {
      const username = request.params.username.toLowerCase();

      const developer = await DeveloperModel.findOne({
        username,
      }).lean<Developer>();

      if (!developer) {
        return reply.status(404).send({
          error: "not_found",
          message: `${username} has not been indexed yet. POST /discover to index them.`,
        });
      }

      if (
        developer.ingestionStatus === "pending" ||
        developer.ingestionStatus === "running"
      ) {
        return reply.status(202).send({
          status: developer.ingestionStatus,
          username,
          message: `Profile for ${username} is being indexed. Check back shortly.`,
        });
      }

      return reply.send({ developer });
    },
  );
  //GET /developer/:username
  // returns the developer profile if ingestion is complete, otherwise returns appropriate status messages for pending/failed states.

  fastify.get<{ Params: { username: string } }>(
    "/developer/:username",
    async (request, reply) => {
      const username = request.params.username.toLowerCase();

      const developer = await DeveloperModel.findOne({
        username,
      }).lean<Developer>();

      if (!developer) {
        return reply.status(404).send({
          error: "not_found",
          message: `${username} has not been indexed yet. POST /discover to index them.`,
        });
      }

      if (
        developer.ingestionStatus === "pending" ||
        developer.ingestionStatus === "running"
      ) {
        return reply.status(202).send({
          status: developer.ingestionStatus,
          username,
          message: `Profile for ${username} is being indexed. Check back shortly.`,
        });
      }

      if (developer.ingestionStatus === "failed") {
        return reply.status(500).send({
          error: "ingestion_failed",
          message: `Ingestion for ${username} failed. Please try again later.`,
        });
      }

      return reply.send({ developer });
    },
  );
}
