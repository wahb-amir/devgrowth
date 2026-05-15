import { DeveloperModel } from "../../db/models/developer.model.js";
import { jobQueue, JobHandler } from "../queue.js";
import { enqueueTracked } from "../TrackedEnqueue.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const GITHUB_API_BASE = "https://api.github.com";

/* ---------------- TYPES ---------------- */

type GitHubProfile = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  location: string | null;
  company: string | null;
  blog: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
};

/* ---------------- GITHUB PRE-FLIGHT ---------------- */

async function fetchGithubProfile(
  username: string,
): Promise<GitHubProfile | null> {
  const res = await fetch(`${GITHUB_API_BASE}/users/${username}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });

  if (res.status === 404) return null;

  // IMPORTANT: classify retryable errors
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`github_rate_limit_${res.status}`);
    (err as any).retryable = true;
    throw err;
  }

  if (res.status >= 500) {
    const err = new Error(`github_server_error_${res.status}`);
    (err as any).retryable = true;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`github_unknown_error_${res.status}`);
    (err as any).retryable = false;
    throw err;
  }

  return (await res.json()) as GitHubProfile;
}
/* ---------------- JOB ---------------- */

/**
 * discover:developer
 * - validates user exists on GitHub
 * - enriches profile once
 * - passes data to ingest (no duplicate fetch)
 */
export const discoverDev: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { username, source } = job.payload || {};

    if (!username || typeof username !== "string") {
      return {
        success: false,
        error: "username_required",
        durationMs: Date.now() - start,
      };
    }

    const normalizedUsername = username.trim().toLowerCase();
    console.info(`[Job] discover:developer — ${normalizedUsername}`);

    /* ---------------- DB LOOKUP ---------------- */

    const existing = await DeveloperModel.findOne({
      username: normalizedUsername,
    });

    const now = Date.now();

    /* ---------------- CASE A — already processing ---------------- */

    if (existing?.ingestionStatus === "processing") {
      return {
        success: true,
        action: "skipped_processing",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- CASE B — fresh ---------------- */

    const isFresh =
      existing?.lastFetchedAt &&
      now - new Date(existing.lastFetchedAt).getTime() < DAY_MS;

    if (existing && existing.ingestionStatus === "completed" && isFresh) {
      return {
        success: true,
        action: "skipped_fresh",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- PRE-FLIGHT GITHUB CHECK ---------------- */

    let profile;

    try {
      profile = await fetchGithubProfile(normalizedUsername);
    } catch (err: any) {
      /* ---------------- SMART FAILURE HANDLING ---------------- */

      const status = err?.message || "UNKNOWN_ERROR";

      let failureDoc: any = null;

      if (status.includes("404")) {
        failureDoc = {
          code: "GITHUB_NOT_FOUND",
          retryAt: new Date(now + DAY_MS),
        };
      } else if (status.includes("403") || status.includes("429")) {
        failureDoc = {
          code: "GITHUB_RATE_LIMIT",
          retryAt: new Date(now + 10 * 60 * 1000), // 10 min
        };
      } else if (status.includes("5")) {
        failureDoc = {
          code: "GITHUB_SERVER_ERROR",
          retryAt: new Date(now + 5 * 60 * 1000), // 5 min
        };
      } else {
        failureDoc = {
          code: "UNKNOWN_ERROR",
          retryAt: new Date(now + 30 * 60 * 1000),
        };
      }

      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "failed",
            failure: {
              ...failureDoc,
              failedAt: new Date(),
            },
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "github_fetch_failed",
        username: normalizedUsername,
        error: failureDoc.code,
        retryable: failureDoc.code !== "GITHUB_NOT_FOUND",
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- USER NOT FOUND ---------------- */

    if (!profile) {
      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "failed",
            failure: {
              code: "GITHUB_NOT_FOUND",
              retryAt: new Date(now + DAY_MS),
              failedAt: new Date(),
            },
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "user_not_found",
        username: normalizedUsername,
        error: "GITHUB_NOT_FOUND",
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- UPSERT SUCCESS PATH ---------------- */

    if (existing) {
      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "pending",
            failure: null, // 🚨 clear failure on success
            lastQueuedAt: new Date(),
          },
        },
      );
    } else {
      await DeveloperModel.create({
        username: normalizedUsername,
        githubId: profile.id,
        ingestionStatus: "pending",
        source: source || "discovery",
        lastQueuedAt: new Date(),
        metadata: {
          name: profile.name,
          avatarUrl: profile.avatar_url,
          bio: profile.bio,
          location: profile.location,
          company: profile.company,
          githubCreatedAt: profile.created_at,
        },
      });
    }

    /* ---------------- QUEUE INGEST ---------------- */

    enqueueTracked(
      {
        name: "ingest:developer",
        payload: {
          username: normalizedUsername,
          profile,
          priority: source === "manual" ? 10 : 5,
        },
        metadata: { username: normalizedUsername, source: "discovery" },
      },
      {
        developerId: profile.id.toString(),
        source: source || "discovery",
      },
    );

    return {
      success: true,
      action: "queued_ingest",
      username: normalizedUsername,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    console.error("[Job] discover:developer failed:", error);

    return {
      success: false,
      error: error?.message || "discover_developer_failed",
      retryable: error?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};
