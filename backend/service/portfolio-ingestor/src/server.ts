import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { getConfig } from "./lib/config.js";
import { healthRoutes } from "./routes/health.js";
import { portfolioRoutes } from "./routes/portfolio.js";
export async function buildServer() {
  const config = getConfig();
  const isDev = config.NODE_ENV === "development";

  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(isDev && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    },
  });

  // Core Plugins
  await fastify.register(sensible);
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });
  fastify.register(healthRoutes);
  fastify.register(portfolioRoutes);

  // Global Error Handler
  fastify.setErrorHandler((error, _req, reply) => {
    fastify.log.error(error);

    const statusCode = error.statusCode ?? 500;
    const message = isDev ? error.message : "An unexpected error occurred.";

    return reply.status(statusCode).send({
      error: statusCode === 400 ? "validation_error" : "internal_error",
      message,
    });
  });
  

  // Default 404
  fastify.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({
      error: "not_found",
      message: "Route not found.",
    });
  });

  return fastify;
}
