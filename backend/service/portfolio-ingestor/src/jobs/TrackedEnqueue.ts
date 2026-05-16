import { Job, SimpleJobQueue, jobQueue } from "./queue.js";

const STATE_TRACKER_URL =
  process.env.STATE_TRACKER_URL ?? "http://localhost:3000";

const TRACKER_TIMEOUT_MS = 2000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getJobPath(jobId: string, suffix = ""): string {
  // Only encode for URL path safety
  return `/jobs/${encodeURIComponent(jobId)}${suffix}`;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

export async function trackerPost(
  path: string,
  body: Record<string, unknown>
): Promise<void> {
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
      console.warn(
        `[tracker] POST ${path} returned ${res.status} — continuing`
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

export function bestEffort(
  label: string,
  fn: () => Promise<void>
): void {
  fn().catch((err: unknown) => {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timed out after ${TRACKER_TIMEOUT_MS}ms`
          : err.message
        : String(err);

    console.error(
      `[tracker] ${label} — ${reason} (non-fatal)`
    );
  });
}

// ─── Lifecycle hooks ────────────────────────────────────────────────────────

export function registerTrackerHooks(
  queue: SimpleJobQueue = jobQueue
): void {
  queue.setLifecycleHooks(
    (jobId, jobName) => {
      bestEffort(`step/complete ${jobId}`, () =>
        trackerPost(
          getJobPath(jobId, "/step/complete"),
          { step: jobName }
        )
      );
    },

    (jobId, jobName, error) => {
      bestEffort(`step/fail ${jobId}`, () =>
        trackerPost(
          getJobPath(jobId, "/step/fail"),
          { step: jobName, error }
        )
      );
    }
  );

  console.info("✅ [tracker] lifecycle hooks registered");
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface EnqueueTrackedOptions {
  maxAttempts?: number;
  queue?: SimpleJobQueue;
  actorType: string;
  actorId: string;
  source: string;
  sourceRef?: string;
  parentJobId?: string;
  metadata?: Record<string, unknown>;
}

export function enqueueTracked(
  job: Job,
  {
    maxAttempts = 3,
    queue = jobQueue,
    actorType,
    actorId,
    source,
    sourceRef,
    parentJobId,
    metadata: _metadata,
  }: EnqueueTrackedOptions
): string {
  const jobId = queue.enqueue(job, maxAttempts);

  bestEffort(`init ${jobId}`, async () => {
    // Store RAW job id
    await trackerPost("/jobs", {
      job_id: jobId,
      workflow_type: job.name,
      actor_type: actorType,
      actor_id: actorId,
      source,
      ...(sourceRef ? { source_ref: sourceRef } : {}),
      ...(parentJobId ? { parent_job_id: parentJobId } : {}),
    });

    // Encode only for URL path segments
    await trackerPost(getJobPath(jobId, "/start"), {});
    await trackerPost(
      getJobPath(jobId, "/step/start"),
      { step: job.name }
    );
  });

  return jobId;
}