/**
 * SimpleJobQueue — lightweight in-process job queue for Phase 0.
 *
 * Designed to be swapped for BullMQ later without changing handler signatures.
 * Supports concurrency, retry with exponential backoff, and job name routing.
 *
 * To upgrade to BullMQ:
 *   1. Replace this class with a BullMQ Queue + Worker setup
 *   2. Keep the same register() and enqueue() interface
 *   3. Job payloads are identical — no other changes needed
 */
export class SimpleJobQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency
    this.queue = []
    this.handlers = new Map()
    this.isProcessing = false
  }

  /**
   * Register a handler for a named job type.
   * Handler receives the full job object and must return { success, durationMs, error? }
   */
  register(jobName, handler) {
    this.handlers.set(jobName, handler)
    console.info(`✅ Job handler registered: ${jobName}`)
  }

  /**
   * Add a job to the queue. Returns the generated job ID.
   */
  enqueue(job, maxAttempts = 3) {
    const id = `${job.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    this.queue.push({ id, job, enqueuedAt: new Date(), attempts: 0, maxAttempts })
    console.info(`📥 Job enqueued: ${job.name} [${id}]`)
    void this.process()
    return id
  }

  get depth() {
    return this.queue.length
  }

  async process() {
    if (this.isProcessing) return
    this.isProcessing = true

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.concurrency)

      await Promise.all(
        batch.map(async (queued) => {
          const handler = this.handlers.get(queued.job.name)

          if (!handler) {
            console.warn(`⚠️  No handler for job: ${queued.job.name}`)
            return
          }

          queued.attempts++
          const start = Date.now()

          try {
            console.info(
              `🔄 Processing: ${queued.job.name} [${queued.id}] attempt ${queued.attempts}`
            )
            const result = await handler(queued.job)

            if (result.success) {
              console.info(
                `✅ Done: ${queued.job.name} [${queued.id}] in ${result.durationMs}ms`
              )
            } else {
              console.warn(
                `⚠️  Failed: ${queued.job.name} [${queued.id}]: ${result.error ?? 'unknown'}`
              )
              this.maybeRequeue(queued, result.error)
            }
          } catch (err) {
            const durationMs = Date.now() - start
            const error = err instanceof Error ? err.message : String(err)
            console.error(
              `❌ Threw: ${queued.job.name} [${queued.id}] after ${durationMs}ms — ${error}`
            )
            this.maybeRequeue(queued, error)
          }
        })
      )
    }

    this.isProcessing = false
  }

  maybeRequeue(queued, error) {
    if (queued.attempts < queued.maxAttempts) {
      const delay = Math.pow(2, queued.attempts) * 1000 // exponential backoff
      console.info(
        `🔁 Requeueing ${queued.job.name} [${queued.id}] in ${delay}ms ` +
          `(attempt ${queued.attempts}/${queued.maxAttempts})`
      )
      setTimeout(() => {
        this.queue.push(queued)
        void this.process()
      }, delay)
    } else {
      console.error(
        `💀 Dead letter: ${queued.job.name} [${queued.id}] after ${queued.attempts} attempts — ${error ?? 'unknown'}`
      )
    }
  }
}

export const jobQueue = new SimpleJobQueue(2)
