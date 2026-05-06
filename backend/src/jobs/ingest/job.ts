import { DeveloperModel } from "../../db/models/developer.model.js";
import { RawSnapshotModel } from "../../db/models/raw-snapshot.model.js";
import { jobQueue, JobHandler } from "../queue.js";

const GITHUB_API_BASE = "https://api.github.com";
const PIPELINE_VERSION = 1;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

type GitHubRepo = {
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  archived: boolean;
  disabled: boolean;
};

type GitHubEvent = {
  type: string;
  created_at: string;
};

type FetchStats = {
  rateLimitRemaining: number;
  requestsUsed: number;
  durationMs: number;
};

/* ---------------- FETCH HELPERS ---------------- */

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
}

async function fetchJson<T>(url: string, stats: FetchStats): Promise<T> {
  stats.requestsUsed++;

  const res = await fetch(url, { headers: githubHeaders() });

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining) stats.rateLimitRemaining = Number(remaining);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`github_api_error_${res.status}: ${body}`);
  }

  return (await res.json()) as T;
}

async function fetchAllPages<T>(
  buildUrl: (p: number) => string,
  stats: FetchStats,
  maxPages = 3,
) {
  const all: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchJson<T[]>(buildUrl(page), stats);
    if (!data.length) break;
    all.push(...data);
    if (data.length < 100) break;
  }

  return all;
}

async function fetchGithubData(username: string) {
  const stats: FetchStats = {
    rateLimitRemaining: 0,
    requestsUsed: 0,
    durationMs: 0,
  };

  const start = Date.now();

  const profile = await fetchJson<GitHubProfile>(
    `${GITHUB_API_BASE}/users/${username}`,
    stats,
  );

  const repos = await fetchAllPages<GitHubRepo>(
    (p) =>
      `${GITHUB_API_BASE}/users/${username}/repos?per_page=100&page=${p}`,
    stats,
    5,
  );

  const events = await fetchAllPages<GitHubEvent>(
    (p) =>
      `${GITHUB_API_BASE}/users/${username}/events?per_page=100&page=${p}`,
    stats,
    2,
  );

  stats.durationMs = Date.now() - start;

  return { profile, repos, events, stats };
}

/* ---------------- NORMALIZATION ---------------- */

function normalize(profile: GitHubProfile, repos: GitHubRepo[], events: GitHubEvent[]) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const recent = events.filter(
    (e) => new Date(e.created_at).getTime() >= cutoff,
  );

  const languages: Record<string, number> = {};
  let stars = 0;
  let forks = 0;

  for (const r of repos) {
    if (r.archived || r.disabled) continue;

    stars += r.stargazers_count || 0;
    forks += r.forks_count || 0;

    if (r.language) {
      languages[r.language] = (languages[r.language] || 0) + 1;
    }
  }

  return {
    repoStats: {
      totalRepos: repos.length,
      totalStars: stars,
      totalForks: forks,
      languages,
    },
    activity_30d: {
      pushes: recent.filter((e) => e.type === "PushEvent").length,
      prs: recent.filter((e) => e.type === "PullRequestEvent").length,
      issues: recent.filter((e) => e.type === "IssuesEvent").length,
      releases: recent.filter((e) => e.type === "ReleaseEvent").length,
    },
  };
}

/* ---------------- JOB ---------------- */

export const ingestDev: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload || {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalized = username.trim().toLowerCase();

  /* ---------------- COOLDOWN CHECK ---------------- */
  const existing = await DeveloperModel.findOne({ username: normalized }).lean();

  if (
    existing?.lastFetchedAt &&
    Date.now() - new Date(existing.lastFetchedAt).getTime() < COOLDOWN_MS
  ) {
    return {
      success: true,
      action: "skipped_cooldown",
      username: normalized,
      durationMs: Date.now() - start,
    };
  }

  try {
    /* ---------------- LOCK ---------------- */
    const locked = await DeveloperModel.findOneAndUpdate(
      {
        username: normalized,
        ingestionStatus: { $ne: "processing" },
      },
      {
        $set: {
          ingestionStatus: "processing",
          ingestionLock: true,
          ingestionLockAt: new Date(),
          failureReason: null,
        },
        $setOnInsert: {
          username: normalized,
          source: "ingest",
          githubId: 0,
        },
      },
      { upsert: true, new: true },
    );

    if (!locked?._id) throw new Error("lock_failed");

    /* ---------------- FETCH ---------------- */
    const { profile, repos, events, stats } =
      await fetchGithubData(normalized);

    /* ---------------- NORMALIZE ---------------- */
    const normalizedData = normalize(profile, repos, events);

    /* ---------------- UPDATE DEV ---------------- */
    await DeveloperModel.updateOne(
      { username: normalized },
      {
        $set: {
          githubId: profile.id,
          metadata: {
            name: profile.name,
            avatarUrl: profile.avatar_url,
            bio: profile.bio,
            location: profile.location,
            company: profile.company,
          },
          lastFetchedAt: new Date(),
          ingestionStatus: "completed",
          ingestionLock: false,
        },
      },
    );

    /* ---------------- SNAPSHOT (CLEAN) ---------------- */
    const snapshot = await RawSnapshotModel.create({
      developerId: locked._id,
      takenAt: new Date(),
      pipelineVersion: PIPELINE_VERSION,

      profile: {
        id: profile.id,
        login: profile.login,
        followers: profile.followers,
        public_repos: profile.public_repos,
        created_at: profile.created_at,
      },

      repoStats: normalizedData.repoStats,
      activity_30d: normalizedData.activity_30d,

      fetchStats: {
        rateLimitRemaining: stats.rateLimitRemaining,
        requestsUsed: stats.requestsUsed,
        durationMs: stats.durationMs,
      },
    });

    /* ---------------- QUEUE SCORE ---------------- */
    await jobQueue.enqueue({
      name: "score:developer",
      payload: {
        username: normalized,
        rawSnapshotId: snapshot._id,
      },
    });

    return {
      success: true,
      action: "queued_scoring",
      username: normalized,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await DeveloperModel.updateOne(
      { username: normalized },
      {
        $set: {
          ingestionStatus: "failed",
          ingestionLock: false,
          failureReason: err instanceof Error ? err.message : "error",
        },
      },
    );

    throw err;
  }
};