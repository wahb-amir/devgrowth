export interface CreateStepInput {
  job_id: string;
  step_name: string;
}

export interface UpdateStepInput {
  job_id: string;
  step_name: string;
  status: string;
  error?: string;
  payload?: Record<string, unknown>;
}

export interface JobStep {
  id: number;
  job_id: string;
  step_name: string;
  status: string;
  attempt: number;
  started_at: Date | null;
  ended_at: Date | null;
  error: string | null;
  created_at: Date;
}
