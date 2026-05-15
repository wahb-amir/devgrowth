import { stepsRepository } from "./steps.repository";
import { JobStep } from "./steps.types";

export const stepsService = {
  async startStep(job_id: string, step_name: string): Promise<JobStep> {
    return stepsRepository.upsertStart({ job_id, step_name });
  },

  async completeStep(
    job_id: string,
    step_name: string,
  ): Promise<JobStep | null> {
    return stepsRepository.markSuccess(job_id, step_name);
  },

  async failStep(
    job_id: string,
    step_name: string,
    error: string,
  ): Promise<JobStep | null> {
    return stepsRepository.markFailed(job_id, step_name, error);
  },

  async getStepsByJobId(job_id: string): Promise<JobStep[]> {
    return stepsRepository.findByJobId(job_id);
  },
};
