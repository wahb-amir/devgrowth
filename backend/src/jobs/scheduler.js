import cron from 'node-cron'
import { jobQueue } from './queue.js'
import { DeveloperModel } from '../db/models/index.js'
import { getConfig } from '../lib/config.js'
import { hasRateLimitHeadroom } from '../lib/github-client.js'

export function registerScheduledJobs() {
  const config = getConfig()

  // ─── Hourly ingestion ────────────────────────────────────────────────────
  // Runs at the top of every hour.
  // Finds tracked developers not ingested in the last 23 hours and enqueues them.
  cron.schedule('0 * * * *', async () => {
    console.info('[CRON] Hourly ingestion tick starting...')

    try {
      const hasHeadroom = await hasRateLimitHeadroom(config.INGESTION_BATCH_SIZE * 80)
      if (!hasHeadroom) {
        console.warn('[CRON] Not enough GitHub rate limit headroom. Skipping tick.')
        return
      }

      const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000)

      const due = await DeveloperModel.find({
        trackingEnabled: true,
        ingestionStatus: { $nin: ['running'] },
        $or: [{ lastFetchedAt: null }, { lastFetchedAt: { $lt: cutoff } }],
      })
        .sort({ lastFetchedAt: 1 }) // oldest first
        .limit(config.INGESTION_BATCH_SIZE)
        .select('_id username')
        .lean()

      if (due.length === 0) {
        console.info('[CRON] No developers due for ingestion.')
        return
      }

      console.info(`[CRON] Enqueueing ${due.length} developers for ingestion.`)

      for (const dev of due) {
        jobQueue.enqueue({
          name: 'ingest:developer',
          payload: { developerId: String(dev._id), username: dev.username },
        })
      }
    } catch (err) {
      console.error('[CRON] Hourly ingestion tick failed:', err)
    }
  })

  // ─── Weekly reports ──────────────────────────────────────────────────────
  // Runs every Sunday at 00:00 UTC.
  cron.schedule('0 0 * * 0', async () => {
    console.info('[CRON] Weekly report generation starting...')

    try {
      const weekOf = new Date().toISOString().split('T')[0]

      const tracked = await DeveloperModel.find({
        trackingEnabled: true,
        ingestionStatus: 'complete',
      })
        .select('_id')
        .lean()

      console.info(`[CRON] Enqueueing weekly reports for ${tracked.length} developers.`)

      for (const dev of tracked) {
        jobQueue.enqueue({
          name: 'report:weekly',
          payload: { developerId: String(dev._id), weekOf },
        })
      }
    } catch (err) {
      console.error('[CRON] Weekly report job failed:', err)
    }
  })

  console.info('✅ Scheduled jobs registered.')
}
