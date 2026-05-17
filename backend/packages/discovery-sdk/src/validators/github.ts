import { GitHubUsernameValidationResult } from "../types";
/**
 * Normalizes, cleans, and strictly validates a raw GitHub username.
 * Blocks URLs, injection attempts, and invalid GitHub formats.
 * 
 * @param rawInput - The uncleaned string received from the frontend
 */
export function validateAndCleanGitHubUsername(rawInput: unknown): GitHubUsernameValidationResult {
  // 1. Defensively ensure the input is actually a string
  if (typeof rawInput !== 'string') {
    return {
      isValid: false,
      username: null,
      error: 'Input must be a valid string.'
    };
  }

  // 2. Trim accidental leading/trailing whitespace
  const cleanedUsername = rawInput.trim();

  // 3. GitHub Username Constraints Regex:
  // - ^[a-zA-Z0-9]        : Must start with an alphanumeric character.
  // - (?!.*--)[a-zA-Z0-9-]: Cannot contain consecutive hyphens (--).
  // - {0,37}              : Limits length (1 char start + 37 middle + 1 end = max 39).
  // - [a-zA-Z0-9]$        : Must end with an alphanumeric character.
  // - |^[a-zA-Z0-9]$      : Allows single-character alphanumeric usernames (e.g., "g").
  const githubRegex = /^(?:[a-zA-Z0-9](?:(?!.*--)[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?|^[a-zA-Z0-9])$/;

  if (!githubRegex.test(cleanedUsername)) {
    return {
      isValid: false,
      username: null,
      error: 'Invalid format. Must be 1-39 characters, alphanumeric and single hyphens, and cannot start or end with a hyphen.'
    };
  }

  // 4. Input is safe. Return the cleaned string.
  // Note: If your backend requires strict case-insensitivity, feel free to add .toLowerCase() here.
  return {
    isValid: true,
    username: cleanedUsername
  };
}