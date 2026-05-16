// src/shared/enums.ts

export enum JobStatus {
  QUEUED    = 'queued',
  RUNNING   = 'running',
  COMPLETED = 'completed',
  FAILED    = 'failed',
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED  = 'failed',
}

// Controlled vocabulary — no free-form strings in job_events
export enum EventType {
  JOB_CREATED      = 'JOB_CREATED',
  JOB_STARTED      = 'JOB_STARTED',
  JOB_COMPLETED    = 'JOB_COMPLETED',
  JOB_FAILED       = 'JOB_FAILED',
  STEP_STARTED     = 'STEP_STARTED',
  STEP_COMPLETED   = 'STEP_COMPLETED',
  STEP_FAILED      = 'STEP_FAILED',
  ARTIFACT_STORED  = 'ARTIFACT_STORED',  // when artifact_ref is set
  JOB_RETRIED      = 'JOB_RETRIED',
}

// Controlled actor types — extendable without schema changes
export enum ActorType {
  DEVELOPER    = 'developer',
  USER         = 'user',
  ORGANIZATION = 'organization',
  URL          = 'url',
  JOB          = 'job',          // upstream job triggered this one
  SYSTEM       = 'system',       // cron, internal trigger
}

export enum JobSource {
  GITHUB       = 'github',
  PORTFOLIO    = 'portfolio',
  SEARCH       = 'search',
  SYSTEM       = 'system',
  ORCHESTRATOR = 'orchestrator',
}