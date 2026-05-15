import { EventType } from "../../shared/enums";

export interface CreateEventInput {
  job_id: string;
  event_type: EventType;
  step_name?: string;
  payload?: Record<string, unknown>;
}

export interface JobEvent {
  id: number;
  job_id: string;
  event_type: string;
  step_name: string | null;
  payload: unknown;
  created_at: Date;
}

export interface GetEventsOptions {
  limit?: number;
  offset?: number;
}
