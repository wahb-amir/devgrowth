import { Job, SimpleJobQueue, jobQueue } from "./queue.js";

const STATE_TRACKER_URL =
  process.env.STATE_TRACKER_URL ?? "http://localhost:3000";

const TRACKER_TIMEOUT_MS = 2000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function createJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getJobPath(jobId: string, suffix = ""): string {
  return `/jobs/${encodeURIComponent(jobId)}${suffix}`;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

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
      console.warn(`[tracker] POST ${path} returned ${res.status} — continuing`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function bestEffort(label: string, fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timed out after ${TRACKER_TIMEOUT_MS}ms`
          : err.message
        : String(err);

    console.error(`[tracker] ${label} — ${reason} (non-fatal)`);
  });
}

// ─── Lifecycle hooks ────────────────────────────────────────────────────────

export function registerTrackerHooks(queue: SimpleJobQueue = jobQueue): void {
  queue.setLifecycleHooks(
    (jobId, jobName) => {
      bestEffort(`step/complete ${jobId}`, () =>
        trackerPost(getJobPath(jobId, "/step/complete"), { step: jobName })
      );
    },
    (jobId, jobName, error) => {
      bestEffort(`step/fail ${jobId}`, () =>
        trackerPost(getJobPath(jobId, "/step/fail"), { step: jobName, error })
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

export async function enqueueTracked(
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
): Promise<string> {
  if (!actorType?.trim()) {
    throw new Error("enqueueTracked: actorType is required");
  }
  if (!actorId?.trim()) {
    throw new Error("enqueueTracked: actorId is required");
  }
  if (!source?.trim()) {
    throw new Error("enqueueTracked: source is required");
  }

  const jobId = createJobId();

  try {
    // Create tracker record first, so the job cannot complete before it exists.
    await trackerPost("/jobs", {
      job_id: jobId,
      workflow_type: job.name,
      actor_type: actorType,
      actor_id: actorId,
      source,
      ...(sourceRef ? { source_ref: sourceRef } : {}),
      ...(parentJobId ? { parent_job_id: parentJobId } : {}),
    });

    await trackerPost(getJobPath(jobId, "/start"), {});
    await trackerPost(getJobPath(jobId, "/step/start"), {
      step: job.name,
    });

    // Enqueue only after tracker init succeeds.
    queue.enqueueWithId(jobId, job, maxAttempts);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tracker] init ${jobId} — ${reason} (non-fatal)`);
    throw err;
  }

  return jobId;
}