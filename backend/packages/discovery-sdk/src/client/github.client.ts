import { http } from "./http";
import { validateAndCleanGitHubUsername } from "../validators/github";
import { config } from "../config"

const BASE = config.github.baseUrl;
/**
 * Helper to ensure the username is sanitized and safe before proceeding.
 * Throws an explicit error if validation fails.
 */
function getSafeUsername(username: unknown): string {
  const result = validateAndCleanGitHubUsername(username);
  
  if (!result.isValid) {
    throw new Error(`SDK Validation Error: ${result.error}`);
  }
  
  return result.username;
}

export const githubClient = {
  getDeveloper: (username: string) => {
    const safeUsername = getSafeUsername(username);
    return http(`${BASE}/developer/${safeUsername}`);
  },

  getLatestSnapshot: (username: string) => {
    const safeUsername = getSafeUsername(username);
    return http(`${BASE}/developer/${safeUsername}/snapshot/latest`);
  },

  getInSights: (username: string) => {
    const safeUsername = getSafeUsername(username);
    return http(`${BASE}/developer/${safeUsername}/insights`);
  },
  getDeveloperScore: (username: string) => {
    const safeUsername = getSafeUsername(username);
    return http(`${BASE}/developer/${safeUsername}/score`);
  },
  //TODO: NOT YET IMPLEMENTED - will be used to trigger a re-ingestion from the SDK
  // triggerIngestion: (username: string) => {
  //   const safeUsername = getSafeUsername(username);
  //   return http(`${BASE}/ingest`, {
  //     method: "POST",
  //     body: { username: safeUsername },
  //   });
  // },
};