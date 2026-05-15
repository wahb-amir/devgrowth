export interface CreateJobInput {
  job_id: string;
  developer_id: string;
  source: string;
}

export interface Job {
  job_id: string;
  developer_id: string;
  source: string;
  status: string;
  current_step: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobWithDetails extends Job {
  steps: import('../steps/steps.types').JobStep[];
  events?: import('../events/events.types').JobEvent[];
  eventsMeta?: { total: number; limit: number; offset: number };
}
