export type GitHubUsernameValidationResult = 
  | { isValid: true; username: string; error?: never }
  | { isValid: false; username: null; error: string };