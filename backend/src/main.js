import 'dotenv/config'
import { loadConfig } from './lib/config.js'
import { connectDatabase, disconnectDatabase } from './db/connection.js'
import { buildServer } from './server.js'
import { registerScheduledJobs } from './jobs/scheduler.js'
import { jobQueue } from './jobs/queue.js'

async function main() {
  // 1. Validate env vars — exits cleanly if anything is missing
  const config = loadConfig()
  console.info(`🚀 Starting DevGrowth API [${config.NODE_ENV}]`)

  // 2. Connect to MongoDB — exits if connection fails
  await connectDatabase()

  // 3. Register job handlers (stubs for now — filled in during Phase 1–3)
  registerJobHandlers()

  // 4. Register cron-based scheduled jobs
  registerScheduledJobs()

  // 5. Build and start the HTTP server
  const server = await buildServer()

  try {
    await server.listen({ port: config.PORT, host: config.HOST })
    console.info(`✅ API listening on http://${config.HOST}:${config.PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.info(`\n${signal} received. Shutting down...`)
    try {
      await server.close()
      await disconnectDatabase()
      console.info('✅ Shutdown complete.')
      process.exit(0)
    } catch (err) {
      console.error('Error during shutdown:', err)
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

function registerJobHandlers() {
  // Each stub logs clearly which phase implements the real logic.
  // This means the server boots and the queue works end-to-end in Phase 0.

  jobQueue.register('discover:developer', async (job) => {
    const start = Date.now()
    console.info(`[Job] discover:developer — ${job.payload.username} (stub: Phase 1)`)
    // Phase 1: look up GitHub profile, create DeveloperModel record, enqueue ingest:developer
    return { success: true, durationMs: Date.now() - start }
  })

  jobQueue.register('ingest:developer', async (job) => {
    const start = Date.now()
    console.info(`[Job] ingest:developer — ${job.payload.username} (stub: Phase 1)`)
    // Phase 1: fetch profile, repos, events, PRs, issues → save RawSnapshot → enqueue score:snapshot
    return { success: true, durationMs: Date.now() - start }
  })

  jobQueue.register('score:snapshot', async (job) => {
    const start = Date.now()
    console.info(`[Job] score:snapshot — ${job.payload.rawSnapshotId} (stub: Phase 2)`)
    // Phase 2: normalize raw data → run scoring functions → save ScoredSnapshot → enqueue generate:insights
    return { success: true, durationMs: Date.now() - start }
  })

  jobQueue.register('generate:insights', async (job) => {
    const start = Date.now()
    console.info(`[Job] generate:insights — ${job.payload.scoredSnapshotId} (stub: Phase 3)`)
    // Phase 3: run insight rules against ScoredSnapshot tags → save Insight[] documents
    return { success: true, durationMs: Date.now() - start }
  })

  jobQueue.register('report:weekly', async (job) => {
    const start = Date.now()
    console.info(`[Job] report:weekly — ${job.payload.developerId} week ${job.payload.weekOf} (stub: Phase 5)`)
    // Phase 5: diff last two ScoredSnapshots → generate weekly summary
    return { success: true, durationMs: Date.now() - start }
  })

  console.info('✅ Job handlers registered.')
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
