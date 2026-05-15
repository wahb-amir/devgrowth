import prisma from "../../config/db";
import { StepStatus } from "../../shared/enums";
import { CreateStepInput, JobStep } from "./steps.types";

export const stepsRepository = {
  async upsertStart(input: CreateStepInput): Promise<JobStep> {
    // Check if there's already an existing step — if so, increment attempt
    const existing = await prisma.jobStep.findFirst({
      where: { job_id: input.job_id, step_name: input.step_name },
      orderBy: { attempt: "desc" },
    });

    if (existing) {
      return prisma.jobStep.create({
        data: {
          job_id: input.job_id,
          step_name: input.step_name,
          status: StepStatus.RUNNING,
          attempt: existing.attempt + 1,
          started_at: new Date(),
        },
      });
    }

    return prisma.jobStep.create({
      data: {
        job_id: input.job_id,
        step_name: input.step_name,
        status: StepStatus.RUNNING,
        attempt: 1,
        started_at: new Date(),
      },
    });
  },

  async markSuccess(
    job_id: string,
    step_name: string,
  ): Promise<JobStep | null> {
    const step = await prisma.jobStep.findFirst({
      where: { job_id, step_name, status: StepStatus.RUNNING },
      orderBy: { attempt: "desc" },
    });

    if (!step) return null;

    return prisma.jobStep.update({
      where: { id: step.id },
      data: {
        status: StepStatus.SUCCESS,
        ended_at: new Date(),
      },
    });
  },

  async markFailed(
    job_id: string,
    step_name: string,
    error: string,
  ): Promise<JobStep | null> {
    const step = await prisma.jobStep.findFirst({
      where: { job_id, step_name, status: StepStatus.RUNNING },
      orderBy: { attempt: "desc" },
    });

    if (!step) return null;

    return prisma.jobStep.update({
      where: { id: step.id },
      data: {
        status: StepStatus.FAILED,
        ended_at: new Date(),
        error,
      },
    });
  },

  async findByJobId(jobId: string): Promise<JobStep[]> {
    return prisma.jobStep.findMany({
      where: { job_id: jobId },
      orderBy: [{ attempt: "asc" }, { created_at: "asc" }],
    });
  },
};
