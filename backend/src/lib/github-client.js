import { Octokit } from '@octokit/rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import { getConfig } from './config.js'

const ThrottledOctokit = Octokit.plugin(retry, throttling)

let _client = null

export function getGitHubClient() {
  if (_client) return _client

  const config = getConfig()

  _client = new ThrottledOctokit({
    auth: config.GITHUB_TOKEN,

    retry: {
      doNotRetry: ['429'],
    },

    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.warn(
          `GitHub rate limit hit for ${options.method} ${options.url}. ` +
            `Retry after ${retryAfter}s. Attempt: ${retryCount}`
        )
        return retryCount < 2
      },
      onSecondaryRateLimit: (retryAfter, options) => {
        console.warn(
          `GitHub secondary rate limit hit for ${options.method} ${options.url}. ` +
            `Backing off ${retryAfter}s.`
        )
        return false
      },
    },
  })

  return _client
}

/**
 * Returns current GitHub API rate limit status.
 * Call before a batch ingestion run to check headroom.
 */
export async function getRateLimitStatus() {
  const octokit = getGitHubClient()
  const { data } = await octokit.rateLimit.get()
  const core = data.resources.core

  return {
    limit: core.limit,
    remaining: core.remaining,
    reset: new Date(core.reset * 1000),
    used: core.used,
  }
}

/**
 * Returns true if we have enough headroom for the next ingestion batch.
 * One full developer ingestion costs roughly 60–80 API requests.
 */
export async function hasRateLimitHeadroom(requiredRequests = 80) {
  const status = await getRateLimitStatus()
  return status.remaining >= requiredRequests
}
