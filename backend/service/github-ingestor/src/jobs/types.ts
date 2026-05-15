export type JobName =
  | "discover:developer"
  | "ingest:developer"
  | "score:snapshot"
  | "generate:insights"
  | "report:weekly";

/**
 * Base job result returned by all handlers
 */
export interface JobResult {
  success: boolean;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Individual job definitions
 */

export interface DiscoverDeveloperJob {
  name: "discover:developer";
  payload: {
    username: string;
    source: "search" | "manual" | "cron" | "referral";
  };
}

export interface IngestDeveloperJob {
  name: "ingest:developer";
  payload: {
    developerId: string;
    username: string;
    force?: boolean;
  };
}

export interface ScoreSnapshotJob {
  name: "score:snapshot";
  payload: {
    rawSnapshotId: string;
    developerId: string;
  };
}

export interface GenerateInsightsJob {
  name: "generate:insights";
  payload: {
    scoredSnapshotId: string;
    developerId: string;
    previousScoredSnapshotId?: string;
  };
}

export interface WeeklyReportJob {
  name: "report:weekly";
  payload: {
    developerId: string;
    weekOf: string;
  };
}

/**
 * Union of all jobs
 */
export type AnyJob =
  | DiscoverDeveloperJob
  | IngestDeveloperJob
  | ScoreSnapshotJob
  | GenerateInsightsJob
  | WeeklyReportJob;

export type JobMap = {
  "discover:developer": DiscoverDeveloperJob;
  "ingest:developer": IngestDeveloperJob;
  "score:snapshot": ScoreSnapshotJob;
  "generate:insights": GenerateInsightsJob;
  "report:weekly": WeeklyReportJob;
};
