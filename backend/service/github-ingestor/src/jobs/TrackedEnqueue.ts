import { Job, JobHandler, JobResult, SimpleJobQueue, jobQueue } from "./queue.js";

const STATE_TRACKER_URL =
  process.env.STATE_TRACKER_URL ?? "http://localhost:3000";
const TRACKER_TIMEOUT_MS = 2000;

async function trackerPost(path: string, body: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACKER_TIMEOUT_MS);
  try {
    const res = await fetch(`${STATE_TRACKER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[tracker] POST ${path} returned ${res.status} — continuing`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function bestEffort(label: string, fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    const reason =
      err instanceof Error
        ? err.name === "AbortError" ? `timed out after ${TRACKER_TIMEOUT_MS}ms` : err.message
        : String(err);
    console.error(`[tracker] ${label} — ${reason} (non-fatal)`);
  });
}

export interface EnqueueTrackedOptions {
  maxAttempts?: number;
  queue?: SimpleJobQueue;
  developerId: string;
  source: string;
}

export function enqueueTracked(
  job: Job,
  { maxAttempts = 3, queue = jobQueue, developerId, source }: EnqueueTrackedOptions,
): string {
  const jobId = queue.enqueue(job, maxAttempts);

  // Create the job record
  bestEffort(`create ${jobId}`, () =>
    trackerPost("/jobs", { job_id: jobId, developer_id: developerId, source })
  );

  // Start it immediately (queued → running)
  bestEffort(`start ${jobId}`, () =>
    trackerPost(`/jobs/${jobId}/start`, {})
  );

  // Wrap the handler for THIS specific jobId
  const originalHandler = (queue as any).handlers.get(job.name) as JobHandler | undefined;

  if (!originalHandler) {
    console.warn(`[tracker] No handler for ${job.name} — skipping lifecycle tracking`);
    return jobId;
  }

  const wrappedHandler: JobHandler = async (j: Job) => {
    bestEffort(`step/start ${jobId}`, () =>
      trackerPost(`/jobs/${jobId}/step/start`, { step: job.name })
    );

    let result: JobResult;
    try {
      result = await originalHandler(j);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      bestEffort(`step/fail ${jobId}`, () =>
        trackerPost(`/jobs/${jobId}/step/fail`, { step: job.name, error })
      );
      throw err; // re-throw so queue's own retry logic still works
    }

    if (result.success) {
      bestEffort(`step/complete ${jobId}`, () =>
        trackerPost(`/jobs/${jobId}/step/complete`, { step: job.name })
      );
    } else {
      bestEffort(`step/fail ${jobId}`, () =>
        trackerPost(`/jobs/${jobId}/step/fail`, {
          step: job.name,
          error: result.error ?? "unknown_failure",
        })
      );
    }

    return result;
  };

  // Temporarily override — queue picks up the wrapped version for this execution
  queue.register(job.name, wrappedHandler);

  // Restore original handler after this tick so other enqueued jobs aren't affected
  setImmediate(() => queue.register(job.name, originalHandler));

  return jobId;
}
