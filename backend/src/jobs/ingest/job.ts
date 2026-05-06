import { DeveloperModel } from "../../db/models/developer.model.js";
import { RawSnapshotModel } from "../../db/models/raw-snapshot.model.js";
import { jobQueue, JobHandler } from "../queue.js";

const GITHUB_API_BASE = "https://api.github.com";
const PIPELINE_VERSION = 1;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  updated_at: string;
};

type GitHubEvent = {
  type: string;
  created_at: string;
};

type FetchStats = {
  totalRepos: number;
  totalEvents: number;
  totalExternalPRs: number;
  totalIssues: number;
  rateLimitRemaining: number;
  requestsUsed: number;
  durationMs: number;
};

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson<T>(
  url: string,
  stats: { requestsUsed: number; rateLimitRemaining: number },
): Promise<T> {
  stats.requestsUsed += 1;

  const res = await fetch(url, { headers: githubHeaders() });

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    const parsed = Number(remaining);
    if (!Number.isNaN(parsed)) stats.rateLimitRemaining = parsed;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`github_api_error_${res.status}${body ? `: ${body}` : ""}`);
  }

  return (await res.json()) as T;
}

async function fetchAllPages<T>(
  buildUrl: (page: number) => string,
  stats: { requestsUsed: number; rateLimitRemaining: number },
  maxPages = 5,
) {
  const all: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const items = await fetchJson<T[]>(buildUrl(page), stats);
    if (!items.length) break;
    all.push(...items);
    if (items.length < 100) break;
  }

  return all;
}

async function fetchGithubData(username: string) {
  const stats = { requestsUsed: 0, rateLimitRemaining: 0 };

  const profileUrl = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`;
  const reposUrl = (page: number) =>
    `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&sort=updated`;
  const eventsUrl = (page: number) =>
    `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/events?per_page=100&page=${page}`;

  const profile = await fetchJson<GitHubProfile>(profileUrl, stats);
  const repos = await fetchAllPages<GitHubRepo>(reposUrl, stats, 10);
  const events = await fetchAllPages<GitHubEvent>(eventsUrl, stats, 3);

  return { profile, repos, events, stats };
}

function normalizeSignals(
  profile: GitHubProfile,
  repos: GitHubRepo[],
  events: GitHubEvent[],
) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeEvents = events.filter(
    (event) => new Date(event.created_at).getTime() >= cutoff,
  );

  const languages: Record<string, number> = {};
  let stars = 0;
  let forks = 0;

  for (const repo of repos) {
    if (!repo.archived && !repo.disabled) {
      stars += repo.stargazers_count || 0;
      forks += repo.forks_count || 0;

      if (repo.language) {
        languages[repo.language] = (languages[repo.language] || 0) + 1;
      }
    }
  }

  return {
    followers: profile.followers || 0,
    repos: repos.length,
    stars,
    forks,
    languages,
    activity_30d: {
      pushes: activeEvents.filter((e) => e.type === "PushEvent").length,
      prs: activeEvents.filter((e) => e.type === "PullRequestEvent").length,
      issues: activeEvents.filter((e) => e.type === "IssuesEvent").length,
      releases: activeEvents.filter((e) => e.type === "ReleaseEvent").length,
    },
  };
}

export const ingestDev: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload || {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalizedUsername = username.trim().toLowerCase();
  
  const existing = await DeveloperModel.findOne({
    username: normalizedUsername,
  }).lean();

  const isFresh =
    existing?.lastFetchedAt &&
    Date.now() - new Date(existing.lastFetchedAt).getTime() < COOLDOWN_MS;

  if (existing && isFresh) {
    return {
      success: true,
      action: "skipped_cooldown",
      username: normalizedUsername,
      durationMs: Date.now() - start,
    };
  }

  try {
    const lockedDev = await DeveloperModel.findOneAndUpdate(
      { username: normalizedUsername },
      {
        $set: {
          ingestionStatus: "processing",
          ingestionLock: true,
          ingestionLockAt: new Date(),
          failureReason: null,
        },
        $setOnInsert: {
          username: normalizedUsername,
          githubId: 0,
          source: "ingest",
          metadata: {},
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );

    if (!lockedDev?._id) {
      throw new Error("developer_lock_failed");
    }

    const { profile, repos, events, stats } =
      await fetchGithubData(normalizedUsername);

    if (!profile) throw new Error("github_profile_missing");

    const normalized = normalizeSignals(profile, repos, events);
    const externalPRs = events.filter((e) => e.type === "PullRequestEvent");
    const issues = events.filter((e) => e.type === "IssuesEvent");

    await DeveloperModel.updateOne(
      { username: normalizedUsername },
      {
        $set: {
          githubId: profile.id,
          source: lockedDev.source || "ingest",
          metadata: {
            name: profile.name,
            avatarUrl: profile.avatar_url,
            bio: profile.bio,
            location: profile.location,
            company: profile.company,
            blog: profile.blog,
          },
          ingestionStatus: "processing",
          lastFetchedAt: new Date(),
        },
      },
    );

    const snapshot = await RawSnapshotModel.create({
      developerId: lockedDev._id,
      takenAt: new Date(),
      pipelineVersion: PIPELINE_VERSION,
      profile: {
        id: profile.id,
        login: profile.login,
        name: profile.name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        location: profile.location,
        company: profile.company,
        blog: profile.blog,
        public_repos: profile.public_repos,
        followers: profile.followers,
        created_at: profile.created_at,
      },
      repos,
      events,
      externalPRs,
      issues,
      fetchStats: {
        totalRepos: repos.length,
        totalEvents: events.length,
        totalExternalPRs: externalPRs.length,
        totalIssues: issues.length,
        rateLimitRemaining: stats.rateLimitRemaining,
        requestsUsed: stats.requestsUsed,
        durationMs: Date.now() - start,
      } satisfies FetchStats,
    });

    await jobQueue.enqueue({
      name: "score:developer",
      payload: {
        username: normalizedUsername,
        rawSnapshotId: snapshot._id,
      },
    });

    await DeveloperModel.updateOne(
      { username: normalizedUsername },
      {
        $set: {
          ingestionStatus: "completed",
          ingestionLock: false,
          ingestionLockAt: null,
          failureReason: null,
          lastFetchedAt: new Date(),
        },
      },
    );

    return {
      success: true,
      action: "queued_scoring",
      username: normalizedUsername,
      durationMs: Date.now() - start,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "ingest_developer_failed";

    await DeveloperModel.updateOne(
      { username: normalizedUsername },
      {
        $set: {
          ingestionStatus: "failed",
          failureReason: message,
          ingestionLock: false,
          ingestionLockAt: null,
        },
      },
    );

    console.error("[Job] ingest:developer failed:", error);
    throw error instanceof Error ? error : new Error(message);
  }
};
