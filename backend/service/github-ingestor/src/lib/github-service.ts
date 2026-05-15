import { getGitHubClient } from "./github-client.js";

export async function getRateLimitStatus() {
  const octokit = getGitHubClient();
  const { data } = await octokit.rateLimit.get();

  const core = data.resources.core;

  return {
    limit: core.limit,
    remaining: core.remaining,
    reset: new Date(core.reset * 1000),
    used: core.used,
  };
}

export async function hasRateLimitHeadroom(requiredRequests = 80) {
  const status = await getRateLimitStatus();
  return status.remaining >= requiredRequests;
}
