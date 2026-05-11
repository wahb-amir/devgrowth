import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { getConfig } from "./lib/config.js";
import { healthRoutes } from "./routes/health.js";
import { developerRoutes } from "./routes/developers.js";

export async function buildServer() {
  const config = getConfig();

  const isDev = config.NODE_ENV === "development";

  const fastify = Fastify({
    logger: isDev
      ? {
          level: config.LOG_LEVEL,
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
            },
          },
        }
      : {
          level: config.LOG_LEVEL,
        },
    bodyLimit: 10 * 1024 * 1024,
  });

  await fastify.register(sensible);
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      error: "rate_limit_exceeded",
      message: `Rate limit exceeded. Try again in ${context.after}.`,
    }),
  });

  await fastify.register(healthRoutes);
  await fastify.register(developerRoutes, { prefix: "/api/v1" });

  fastify.setErrorHandler((error, _req, reply) => {
    fastify.log.error(error);

    if (error.validation) {
      return reply.status(400).send({
        error: "validation_error",
        message: error.message,
        details: error.validation,
      });
    }

    return reply.status(error.statusCode ?? 500).send({
      error: "internal_error",
      message:
        config.NODE_ENV === "development"
          ? error.message
          : "An unexpected error occurred.",
    });
  });

  fastify.setNotFoundHandler((_req, reply) => {
    return reply
      .status(404)
      .send({ error: "not_found", message: "Route not found." });
  });

  return fastify;
}
