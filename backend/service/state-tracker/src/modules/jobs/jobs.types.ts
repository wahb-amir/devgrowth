// src/modules/jobs/jobs.types.ts

export interface CreateJobInput {
  job_id:           string;
  workflow_type:    string;
  workflow_version?: string;
  actor_type:       string;
  actor_id:         string;
  source:           string;
  source_ref?:      string;
  parent_job_id?:   string;
}

export interface Job {
  job_id:           string;
  workflow_type:    string;
  workflow_version: string;
  actor_type:       string;
  actor_id:         string;
  source:           string;
  source_ref:       string | null;
  parent_job_id:    string | null;
  artifact_ref:     string | null;
  status:           string;
  current_step:     string | null;
  started_at:       Date | null;
  ended_at:         Date | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface JobWithDetails extends Job {
  steps: import("../steps/steps.types").JobStep[];
  events?: import("../events/events.types").JobEvent[];
  eventsMeta?: { total: number; limit: number; offset: number };
}
