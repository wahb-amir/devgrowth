import prisma from "../../config/db";
import { CreateEventInput, GetEventsOptions, JobEvent } from "./events.types";

export const eventsRepository = {
  async append(input: CreateEventInput): Promise<JobEvent> {
    return prisma.jobEvent.create({
      data: {
        job_id: input.job_id,
        event_type: input.event_type,
        step_name: input.step_name ?? null,
        payload: input.payload ?? undefined,
      },
    });
  },

  async findByJobId(
    jobId: string,
    options: GetEventsOptions = {},
  ): Promise<JobEvent[]> {
    const { limit = 100, offset = 0 } = options;
    return prisma.jobEvent.findMany({
      where: { job_id: jobId },
      orderBy: { created_at: "asc" },
      take: limit,
      skip: offset,
    });
  },

  async countByJobId(jobId: string): Promise<number> {
    return prisma.jobEvent.count({ where: { job_id: jobId } });
  },
};
