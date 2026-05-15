import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export function errorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: "Invalid request body",
      issues: err.errors,
    });
  }

  const statusCode = (err as FastifyError).statusCode ?? 500;
  console.error(`[${req.method}] ${req.url} →`, err.message);

  return reply.status(statusCode).send({
    error: "INTERNAL_ERROR",
    message: statusCode === 500 ? "An unexpected error occurred" : err.message,
  });
}
