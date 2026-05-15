import type { FastifyInstance } from "fastify";
import { getDatabaseStatus } from "../db/connection.js";
import { jobQueue } from "../jobs/queue.js";
import { getConfig } from "../lib/config.js";

/** @param {import('fastify').FastifyInstance} fastify */
export async function healthRoutes(fastify: FastifyInstance) {
  // GET /health — basic liveness probe
  fastify.get("/health", async (_req, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  fastify.get("/health/ready", async (_req, reply) => {
    const config = getConfig();
    const db = getDatabaseStatus();

    const checks = {
      database: db.connected
        ? { status: "ok" }
        : { status: "error", detail: `readyState=${db.readyState}` },
    };

    const allOk = Object.values(checks).every((c) => c.status === "ok");

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
