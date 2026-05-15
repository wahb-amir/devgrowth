import { z } from "zod";

/**
 * 1. Env schema
 */
const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().default("devgrowth"),

  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),

  PIPELINE_VERSION: z.string().default("0.1.0"),
  SCORER_VERSION: z.string().default("0.1.0"),
  INSIGHT_VERSION: z.string().default("0.1.0"),

  INGESTION_BATCH_SIZE: z.coerce.number().default(10),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

/**
 * 2. Infer TypeScript type from schema
 */
export type Config = z.infer<typeof envSchema>;

/**
 * 3. Singleton config store
 */
let _config: Config | null = null;

/**
 * 4. Load + validate env
 */
export function loadConfig(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");

    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }

    process.exit(1);
  }

  _config = result.data;
  return _config;
}

/**
 * 5. Get config (must be loaded first)
 */
export function getConfig(): Config {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }

  return _config;
}
