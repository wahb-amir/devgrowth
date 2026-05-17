import { http } from "./http";
import { validateAndCleanGitHubUsername } from "../validators/github";
const BASE = process.env.GITHUB_SERVICE_URL;

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

  triggerIngestion: (username: string) => {
    const safeUsername = getSafeUsername(username);
    return http(`${BASE}/ingest`, {
      method: "POST",
      body: { username: safeUsername },
    });
  },
};