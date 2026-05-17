/**
 * Safely reads an environment variable or throws an error if it's missing.
 * This ensures your app crashes early if the environment is misconfigured.
 */
function getEnvVar(key: string, required = true): string {
  const value = process.env[key];
  
  if (!value && required) {
    throw new Error(`Configuration Error: Environment variable '${key}' is missing.`);
  }
  
  return value || '';
}

export const config = {
  // Application Node Environment (development, production, test)
  env: process.env.NODE_ENV || 'development',

  // GitHub Service Configurations
  github: {
    baseUrl: getEnvVar('GITHUB_SERVICE_URL'),
    authToken: getEnvVar('GITHUB_SERVICE_TOKEN'),
  },

} as const; // 'as const' makes the config object strictly read-only

// Export a type for use across the application if needed
export type AppConfig = typeof config;