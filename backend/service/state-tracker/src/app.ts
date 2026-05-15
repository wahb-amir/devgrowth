import Fastify from 'fastify';
import { jobsController } from './modules/jobs/jobs.controller';
import { errorHandler } from './middleware/errorHandler';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // ─── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'state-tracker',
    timestamp: new Date().toISOString(),
  }));

  // ─── Routes ───────────────────────────────────────────────────────────────
  app.register(jobsController);

  // ─── Error handler ────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  return app;
}
