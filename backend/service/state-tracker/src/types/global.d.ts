declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    PORT?: string;
    HOST?: string;
    NODE_ENV?: "development" | "production" | "test";
    LOG_LEVEL?: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  }
}
