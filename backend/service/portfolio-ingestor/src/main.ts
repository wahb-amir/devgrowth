import "dotenv/config";

import { loadConfig } from "./lib/config.js";
import { buildServer } from "./server.js";
import { connectDatabase } from "./db/connection.js";

import { jobQueue } from "./jobs/queue.js"
import { registerTrackerHooks } from "./jobs/TrackedEnqueue.js";
import { discoverPortfolio } from "./jobs/discover/job.js";
import { ingestPortfolio } from "./jobs/ingest/job.js";

import { parsePortfolioCollect } from "./jobs/portfolio/collect.job.js";
import { parsePortfolioRendered } from "./jobs/portfolio/rendered.job.js";
import { parsePortfolioStore } from "./jobs/portfolio/store.job.js";

async function main() {
  const config = loadConfig();

  console.info(`🚀 Starting API [${config.NODE_ENV}]`);

  await connectDatabase();

  registerJobHandlers();

  const server = await buildServer();

  try {
    await server.listen({
      port: config.PORT,
      host: config.HOST,
    });

    console.info(`✅ Server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.info(`\n${signal} received. Cleaning up...`);

    try {
      await server.close();
      console.info("✅ Server shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

function registerJobHandlers() {
  console.info("Registering job handlers...");

  // layer 1 — discovery
  jobQueue.register("discover:portfolio", discoverPortfolio);

  // layer 2 — ingestion (normalize + persist seed record)
  jobQueue.register("ingest:portfolio", ingestPortfolio);

  // layer 3 — parse: static path (crawl + extract + merge)
  jobQueue.register("parse:portfolio:collect", parsePortfolioCollect);

  // layer 3b — parse: SPA/JS-rendered fallback (Playwright)
  jobQueue.register("parse:portfolio:rendered", parsePortfolioRendered);

  // layer 4 — parse: persist structured output
  jobQueue.register("parse:portfolio:store", parsePortfolioStore);
  // Wire lifecycle hooks once at module load
  registerTrackerHooks();
  console.info("✅ Job handlers registered.");

}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
