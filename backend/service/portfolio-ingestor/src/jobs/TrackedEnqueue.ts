import { Job, jobQueue, SimpleJobQueue } from "./queue.js";

const STATE_TRACKER_URL =
  process.env.STATE_TRACKER_URL ?? "http://localhost:3000";

const TRACKER_TIMEOUT_MS = 2000;

async function createTrackedJob(
  jobId: string,
  developerId: string,
  source: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACKER_TIMEOUT_MS);

  try {
    const res = await fetch(`${STATE_TRACKER_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        job_id: jobId,
        developer_id: developerId,
        source,
      }),
    });

    if (!res.ok) {
      console.warn(
        `[tracker] create job ${jobId} returned ${res.status} — continuing`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function trackBestEffort(
  jobId: string,
  developerId: string,
  source: string,
): void {
  createTrackedJob(jobId, developerId, source).catch((err: unknown) => {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timed out after ${TRACKER_TIMEOUT_MS}ms`
          : err.message
        : String(err);

    console.error(
      `[tracker] Failed to create job ${jobId} — ${reason} (non-fatal)`,
    );
  });
}

export interface EnqueueTrackedOptions {
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
  queue?: SimpleJobQueue;
  developerId: string;
  source: string;
}

export function enqueueTracked(
  job: Job,
  {
    maxAttempts = 3,
    queue = jobQueue,
    developerId,
    source,
  }: EnqueueTrackedOptions,
): string {
  const jobId = queue.enqueue(job, maxAttempts);

  trackBestEffort(jobId, developerId, source);

  return jobId;
}
