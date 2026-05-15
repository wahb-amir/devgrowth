import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { jobsService } from "./jobs.service";
import { AppError } from "../../shared/errors";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CreateJobSchema = z.object({
  job_id: z.string().min(1),
  developer_id: z.string().min(1),
  source: z.string().min(1),
});

const StartStepSchema = z.object({
  step: z.string().min(1),
});

const CompleteStepSchema = z.object({
  step: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

const FailStepSchema = z.object({
  step: z.string().min(1),
  error: z.string().min(1),
});

const GetJobQuerySchema = z.object({
  includeEvents: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  eventsLimit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 100)),
  eventsOffset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0)),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: err.code ?? "ERROR",
      message: err.message,
    });
  }
  console.error("[controller] Unhandled error:", err);
  return reply
    .status(500)
    .send({ error: "INTERNAL_ERROR", message: "Unexpected error" });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function jobsController(app: FastifyInstance) {
  // POST /jobs — Create a new job
  app.post("/jobs", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CreateJobSchema.parse(req.body);
      const job = await jobsService.createJob(body);
      return reply.status(201).send({ job });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /jobs/:jobId/start — Start a queued job
  app.post(
    "/jobs/:jobId/start",
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const job = await jobsService.startJob(req.params.jobId);
        return reply.send({ job });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /jobs/:jobId/step/start — Start a step
  app.post(
    "/jobs/:jobId/step/start",
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = StartStepSchema.parse(req.body);
        const result = await jobsService.startStep(req.params.jobId, body.step);
        return reply.send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /jobs/:jobId/step/complete — Complete a step
  app.post(
    "/jobs/:jobId/step/complete",
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = CompleteStepSchema.parse(req.body);
        const result = await jobsService.completeStep(
          req.params.jobId,
          body.step,
          body.payload,
        );
        return reply.send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /jobs/:jobId/step/fail — Fail a step
  app.post(
    "/jobs/:jobId/step/fail",
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = FailStepSchema.parse(req.body);
        const result = await jobsService.failStep(
          req.params.jobId,
          body.step,
          body.error,
        );
        return reply.send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /jobs/:jobId — Get full job state
  app.get(
    "/jobs/:jobId",
    async (
      req: FastifyRequest<{
        Params: { jobId: string };
        Querystring: Record<string, string>;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const query = GetJobQuerySchema.parse(req.query);
        const state = await jobsService.getJobState(req.params.jobId, {
          includeEvents: query.includeEvents,
          limit: query.eventsLimit,
          offset: query.eventsOffset,
        });
        return reply.send(state);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
