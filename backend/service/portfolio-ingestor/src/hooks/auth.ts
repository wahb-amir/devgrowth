import { FastifyRequest, FastifyReply } from "fastify";
import {getConfig } from "../lib/config.js";
/**
 * Fastify hook to enforce internal service-to-service authentication.
 */
export async function verifyInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const config = getConfig();

  const authHeader = request.headers.authorization;
  const expectedToken = `Bearer ${config.PORTFOLIO_AUTH_TOKEN}`;

  // If header is missing or doesn't match our secure config token
  if (!authHeader || authHeader !== expectedToken) {
    reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Unauthorized internal service request.",
    });

    return;
  }
}
