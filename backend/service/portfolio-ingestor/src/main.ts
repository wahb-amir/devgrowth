import "dotenv/config";
import { loadConfig } from "./lib/config.js";
import { buildServer } from "./server.js";
import { jobQueue } from "./jobs/queue.js";
import { discoverPortfolio } from "./jobs/discover/job.js";
import { connectDatabase } from "./db/connection.js";
async function main() {
  const config = loadConfig();
  console.info(`🚀 Starting API [${config.NODE_ENV}]`);

  // 2. Server Initialization
  const server = await buildServer();
  await connectDatabase();
  registerJobHandlers();
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    console.info(`✅ Server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // 3. Graceful Shutdown logic
  const shutdown = async (signal: string) => {
    console.info(`\n${signal} received. Cleaning up...`);
    try {
      await server.close();
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

  jobQueue.register("discover:portfolio", discoverPortfolio);


  console.info("✅ Job handlers registered.");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});