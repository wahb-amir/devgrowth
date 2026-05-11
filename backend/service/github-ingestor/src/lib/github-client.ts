import { Octokit } from '@octokit/rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import { getConfig } from './config.js'

/**
 * Extend Octokit with plugins
 */
const ThrottledOctokit = Octokit.plugin(retry, throttling)

/**
 * Proper typed singleton
 */
let _client: InstanceType<typeof ThrottledOctokit> | null = null

export function getGitHubClient(): InstanceType<typeof ThrottledOctokit> {
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