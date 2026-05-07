import "dotenv/config";
import { loadConfig } from "./lib/config.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";
import { buildServer } from "./server.js";
import { registerScheduledJobs } from "./jobs/scheduler.js";
import { discoverDev } from "./jobs/discover/job.js";
import { ingestDev } from "./jobs/ingest/job.js";
import { jobQueue } from "./jobs/queue.js";
import { scoreDev } from "./jobs/score/job.js";
import { generateInsightsJob } from "./jobs/insights/job.js";

async function main() {
  // 1. Validate env vars — exits cleanly if anything is missing
  const config = loadConfig();
  console.info(`🚀 Starting DevGrowth API [${config.NODE_ENV}]`);

  // 2. Connect to MongoDB — exits if connection fails
  await connectDatabase();

  // 3. Register job handlers (stubs for now — filled in during Phase 1–3)
  registerJobHandlers();

  // 4. Register cron-based scheduled jobs
  registerScheduledJobs();

  // 5. Build and start the HTTP server
  const server = await buildServer();

  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    console.info(`✅ API listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  enum Signal {
    SIGINT = "SIGINT",
    SIGTERM = "SIGTERM",
  }
  const shutdown = async (signal: Signal) => {
    console.info(`\n${signal} received. Shutting down...`);
    try {
      await server.close();
      await disconnectDatabase();
      console.info("✅ Shutdown complete.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown(Signal.SIGTERM));
  process.on("SIGINT", () => void shutdown(Signal.SIGINT));
}

function registerJobHandlers() {
  // Each stub logs clearly which phase implements the real logic.
  // This means the server boots and the queue works end-to-end in Phase 0.

  jobQueue.register("discover:developer", discoverDev);

  jobQueue.register("ingest:developer", ingestDev);

  jobQueue.register("score:developer", scoreDev);

  jobQueue.register("generate:insights", generateInsightsJob);

  jobQueue.register("report:weekly", async (job) => {
    const start = Date.now();
    console.info(
      `[Job] report:weekly — ${job.payload.developerId} week ${job.payload.weekOf} (stub: Phase 5)`,
    );
    // Phase 5: diff last two ScoredSnapshots → generate weekly summary
    return { success: true, durationMs: Date.now() - start };
  });

  console.info("✅ Job handlers registered.");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
