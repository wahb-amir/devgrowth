export type Job = {
  name: string;
  [key: string]: any;
};

export type JobResult = {
  success: boolean;
  durationMs: number;

  error?: string;

  action?: string;
  username?: string;

  retryable?: boolean;
  statusCode?: number;
};

export type JobHandler = (job: Job) => Promise<JobResult>;

type QueuedJob = {
  id: string;
  job: Job;
  enqueuedAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  retryable?: boolean;
};

export class SimpleJobQueue {
  private concurrency: number;
  private queue: QueuedJob[];
  private handlers: Map<string, JobHandler>;
  private isProcessing: boolean;

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.queue = [];
    this.handlers = new Map();
    this.isProcessing = false;
  }

  register(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
    console.info(`✅ Job handler registered: ${jobName}`);
  }

  enqueue(job: Job, maxAttempts = 3): string {
    const id = `${job.name}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    this.queue.push({
      id,
      job,
      enqueuedAt: new Date(),
      attempts: 0,
      maxAttempts,
    });

    console.info(`📥 Job enqueued: ${job.name} [${id}]`);
    void this.process();

    return id;
  }

  get depth(): number {
    return this.queue.length;
  }

  private async process(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.concurrency);

      await Promise.all(
        batch.map(async (queued) => {
          const handler = this.handlers.get(queued.job.name);

          if (!handler) {
            console.warn(`⚠️ No handler for job: ${queued.job.name}`);
            return;
          }

          queued.attempts++;
          const start = Date.now();

          try {
            console.info(
              `🔄 Processing: ${queued.job.name} [${queued.id}] attempt ${queued.attempts}`,
            );

            const result = await handler(queued.job);

            if (result.success) {
              console.info(
                `✅ Done: ${queued.job.name} [${queued.id}] in ${result.durationMs}ms`,
              );
              return;
            }

            // ❌ FAILURE (structured)
            queued.lastError =
              result.error ?? (result.success ? "ok" : "unknown_job_failure");

            queued.retryable = result.retryable ?? false;

            console.warn(
              `⚠️ Failed: ${queued.job.name} [${queued.id}]: ${result.error ?? "unknown"}`,
            );

            this.maybeRequeue(queued);
          } catch (err: any) {
            const durationMs = Date.now() - start;

            const errorMessage =
              err instanceof Error ? err.message : String(err);

            const retryable = err?.retryable ?? err?.status >= 500;

            queued.lastError = errorMessage;
            queued.retryable = retryable;

            console.error(
              `❌ Threw: ${queued.job.name} [${queued.id}] after ${durationMs}ms — ${errorMessage}`,
            );

            this.maybeRequeue(queued);
          }
        }),
      );
    }

    this.isProcessing = false;
  }

  private maybeRequeue(queued: QueuedJob): void {
    const retryable = queued.retryable ?? false;

    // ❌ NEVER retry permanent errors
    if (!retryable) {
      console.error(
        `💀 Dead letter (non-retryable): ${queued.job.name} [${queued.id}] — ${queued.lastError}`,
      );
      return;
    }

    // ❌ max attempts reached
    if (queued.attempts >= queued.maxAttempts) {
      console.error(
        `💀 Dead letter (max retries): ${queued.job.name} [${queued.id}] — ${queued.lastError}`,
      );
      return;
    }

    // ⏱ exponential backoff + jitter
    const base = Math.pow(2, queued.attempts) * 1000;
    const jitter = Math.random() * 300;

    const delay = base + jitter;

    console.info(
      `🔁 Requeueing ${queued.job.name} [${queued.id}] in ${Math.round(
        delay,
      )}ms (attempt ${queued.attempts}/${queued.maxAttempts})`,
    );

    setTimeout(() => {
      this.queue.push(queued);
      void this.process();
    }, delay);
  }
}

/**
 * Singleton queue instance
 */
export const jobQueue = new SimpleJobQueue(2);
