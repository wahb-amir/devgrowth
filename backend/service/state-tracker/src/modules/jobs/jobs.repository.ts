import prisma from "../../config/db";
import { CreateJobInput, Job } from "./jobs.types";
import { JobStatus } from "../../shared/enums";

export const jobsRepository = {
  async create(input: CreateJobInput): Promise<Job> {
  return prisma.job.create({
    data: {
      job_id:           input.job_id,
      workflow_type:    input.workflow_type,
      workflow_version: input.workflow_version ?? "1",
      actor_type:       input.actor_type,
      actor_id:         input.actor_id,
      source:           input.source,
      source_ref:       input.source_ref ?? null,
      parent_job_id:    input.parent_job_id ?? null,
      status:           JobStatus.QUEUED,
    },
  });
},

  async findById(jobId: string): Promise<Job | null> {
    return prisma.job.findUnique({ where: { job_id: jobId } });
  },

  async updateStatus(
    jobId: string,
    status: JobStatus,
    currentStep?: string | null,
  ): Promise<Job> {
    return prisma.job.update({
      where: { job_id: jobId },
      data: {
        status,
        ...(currentStep !== undefined ? { current_step: currentStep } : {}),
      },
    });
  },

  async exists(jobId: string): Promise<boolean> {
    const count = await prisma.job.count({ where: { job_id: jobId } });
    return count > 0;
  },
};
