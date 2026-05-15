import { eventsRepository } from "./events.repository";
import { CreateEventInput, GetEventsOptions, JobEvent } from "./events.types";

export const eventsService = {
  /**
   * Append a new event (append-only — never mutates existing events).
   */
  async append(input: CreateEventInput): Promise<JobEvent> {
    return eventsRepository.append(input);
  },

  async getByJobId(
    jobId: string,
    options?: GetEventsOptions,
  ): Promise<{ events: JobEvent[]; total: number }> {
    const [events, total] = await Promise.all([
      eventsRepository.findByJobId(jobId, options),
      eventsRepository.countByJobId(jobId),
    ]);
    return { events, total };
  },
};
