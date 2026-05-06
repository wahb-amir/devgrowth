import { DeveloperModel } from "../../db/models/developer.model.js";
import { jobQueue, JobHandler } from "../queue.js";

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

    // CASE A — already processing
    if (existing?.ingestionStatus === "processing") {
      return {
        success: true,
        action: "skipped_processing",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    // CASE B — fresh
    const isFresh =
      existing?.lastFetchedAt &&
      Date.now() - new Date(existing.lastFetchedAt).getTime() < DAY_MS;

    if (existing && existing.ingestionStatus === "completed" && isFresh) {
      return {
        success: true,
        action: "skipped_fresh",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- PRE-FLIGHT GITHUB CHECK ---------------- */

    const profile = await fetchGithubProfile(normalizedUsername);

    // ❌ user does not exist → stop pipeline early
    if (!profile) {
      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "not_found",
            failureReason: "github_user_not_found",
            lastQueuedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return {
        success: false,
        action: "user_not_found",
        username: normalizedUsername,
        error: "github_user_not_found",
        durationMs: Date.now() - start,
      };
    }

    /* ---------------- UPSERT / UPDATE DEV ---------------- */

    if (existing) {
      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "pending",
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

    await jobQueue.enqueue({
      name: "ingest:developer",
      payload: {
        username: normalizedUsername,
        profile,
        priority: source === "manual" ? 10 : 5,
      },
    });

    return {
      success: true,
      action: "queued_ingest",
      username: normalizedUsername,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    console.error("[Job] discover:developer failed:", error);
    console.log("hello");
    return {
      success: false,
      error: error?.message || "discover_developer_failed",
      retryable: error?.retryable ?? false,
      durationMs: Date.now() - start,
    };
  }
};
