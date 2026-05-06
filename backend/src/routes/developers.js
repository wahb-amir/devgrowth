import { z } from 'zod'
import { DeveloperModel } from '../db/models/index.js'
import { jobQueue } from '../jobs/queue.js'

const usernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/, { message: 'Invalid GitHub username format' })

/** @param {import('fastify').FastifyInstance} fastify */
export async function developerRoutes(fastify) {
  // POST /api/v1/developers/discover
  // Trigger indexing of a GitHub username.
  // Returns existing record if already indexed, otherwise queues a discovery job.
  fastify.post('/developers/discover', async (request, reply) => {
    const parsed = usernameSchema.safeParse(request.body?.username)

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_username',
        message: parsed.error.issues[0]?.message ?? 'Invalid username',
      })
    }

    const username = parsed.data.toLowerCase()

    const existing = await DeveloperModel.findOne({ username }).lean()
    if (existing) {
      return reply.send({
        status: 'existing',
        developer: existing,
        message: `${username} is already indexed.`,
      })
    }

    jobQueue.enqueue({
      name: 'discover:developer',
      payload: { username, source: 'search' },
    })

    return reply.status(202).send({
      status: 'queued',
      username,
      message: `Discovery job queued for ${username}. Profile will be available shortly.`,
    })
  })

  // GET /api/v1/developers/:username
  // Fetch a developer's current record.
  // Returns 404 if not indexed, 202 if indexing is in progress.
  fastify.get('/developers/:username', async (request, reply) => {
    const username = request.params.username.toLowerCase()

    const developer = await DeveloperModel.findOne({ username }).lean()

    if (!developer) {
      return reply.status(404).send({
        error: 'not_found',
        message: `${username} has not been indexed yet. POST /api/v1/developers/discover to index them.`,
      })
    }

    if (developer.ingestionStatus === 'pending' || developer.ingestionStatus === 'running') {
      return reply.status(202).send({
        status: developer.ingestionStatus,
        username,
        message: `Profile for ${username} is being indexed. Check back shortly.`,
      })
    }

    return reply.send({ developer })
  })
}
