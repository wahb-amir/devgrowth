export enum JobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  FAILED = 'failed',
  COMPLETED = 'completed',
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum EventType {
  JOB_CREATED = 'JOB_CREATED',
  JOB_STARTED = 'JOB_STARTED',
  STEP_STARTED = 'STEP_STARTED',
  STEP_COMPLETED = 'STEP_COMPLETED',
  STEP_FAILED = 'STEP_FAILED',
  JOB_COMPLETED = 'JOB_COMPLETED',
  JOB_FAILED = 'JOB_FAILED',
}

export enum JobSource {
  GITHUB = 'github',
  PORTFOLIO = 'portfolio',
}
