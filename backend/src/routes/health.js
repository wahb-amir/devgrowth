import { getDatabaseStatus } from '../db/connection.js'
import { getRateLimitStatus } from '../lib/github-client.js'
import { jobQueue } from '../jobs/queue.js'
import { getConfig } from '../lib/config.js'

/** @param {import('fastify').FastifyInstance} fastify */
export async function healthRoutes(fastify) {
  // GET /health — basic liveness probe
  fastify.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // GET /health/ready — checks all dependencies (suitable for k8s readiness probe)
  fastify.get('/health/ready', async (_req, reply) => {
    const config = getConfig()
    const db = getDatabaseStatus()

    const checks = {
      database: db.connected
        ? { status: 'ok' }
        : { status: 'error', detail: `readyState=${db.readyState}` },
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok')

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'not_ready',
      checks,
      version: config.PIPELINE_VERSION,
      timestamp: new Date().toISOString(),
    })
  })

  // GET /health/deep — full system check including GitHub rate limit and queue depth
  fastify.get('/health/deep', async (_req, reply) => {
    const config = getConfig()
    const db = getDatabaseStatus()

    let githubRateLimit = null
    let githubError = null

    try {
      githubRateLimit = await getRateLimitStatus()
    } catch (err) {
      githubError = err instanceof Error ? err.message : 'unknown error'
    }

    return reply.send({
      status: 'ok',
      database: { connected: db.connected, readyState: db.readyState },
      github: githubError
        ? { status: 'error', error: githubError }
        : {
            status: 'ok',
            remaining: githubRateLimit?.remaining,
            limit: githubRateLimit?.limit,
            reset: githubRateLimit?.reset,
          },
      jobQueue: { depth: jobQueue.depth },
      config: {
        nodeEnv: config.NODE_ENV,
        pipelineVersion: config.PIPELINE_VERSION,
        ingestionBatchSize: config.INGESTION_BATCH_SIZE,
      },
      timestamp: new Date().toISOString(),
    })
  })
}
