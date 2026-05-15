import { jobsRepository } from './jobs.repository';
import { stepsService } from '../steps/steps.service';
import { eventsService } from '../events/events.service';
import { JobStatus, EventType } from '../../shared/enums';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { CreateJobInput, Job, JobWithDetails } from './jobs.types';
import { GetEventsOptions } from '../events/events.types';

export const jobsService = {
  async createJob(input: CreateJobInput): Promise<Job> {
    const exists = await jobsRepository.exists(input.job_id);
    if (exists) {
      throw new ConflictError(`Job already exists: ${input.job_id}`);
    }

    const job = await jobsRepository.create(input);

    // Fire-and-forget event — must NOT block if it fails
    eventsService
      .append({
        job_id: job.job_id,
        event_type: EventType.JOB_CREATED,
        payload: { developer_id: input.developer_id, source: input.source },
      })
      .catch((err) => console.error('[events] JOB_CREATED append failed:', err));

    return job;
  },

  async startJob(jobId: string): Promise<Job> {
    const job = await jobsRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const updated = await jobsRepository.updateStatus(jobId, JobStatus.RUNNING);

    eventsService
      .append({ job_id: jobId, event_type: EventType.JOB_STARTED })
      .catch((err) => console.error('[events] JOB_STARTED append failed:', err));

    return updated;
  },

  async startStep(
    jobId: string,
    stepName: string
  ): Promise<{ job: Job; step: import('../steps/steps.types').JobStep }> {
    const job = await jobsRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const [updatedJob, step] = await Promise.all([
      jobsRepository.updateStatus(jobId, JobStatus.RUNNING, stepName),
      stepsService.startStep(jobId, stepName),
    ]);

    eventsService
      .append({
        job_id: jobId,
        event_type: EventType.STEP_STARTED,
        step_name: stepName,
      })
      .catch((err) => console.error('[events] STEP_STARTED append failed:', err));

    return { job: updatedJob, step };
  },

  async completeStep(
    jobId: string,
    stepName: string,
    payload?: Record<string, unknown>
  ): Promise<{ job: Job; step: import('../steps/steps.types').JobStep | null }> {
    const job = await jobsRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const step = await stepsService.completeStep(jobId, stepName);

    // If all steps are done, mark job as completed
    const steps = await stepsService.getStepsByJobId(jobId);
    const hasRunningSteps = steps.some((s) => s.status === 'running');
    const newStatus = hasRunningSteps ? JobStatus.RUNNING : JobStatus.COMPLETED;

    const updatedJob = await jobsRepository.updateStatus(jobId, newStatus);

    eventsService
      .append({
        job_id: jobId,
        event_type: EventType.STEP_COMPLETED,
        step_name: stepName,
        payload,
      })
      .catch((err) =>
        console.error('[events] STEP_COMPLETED append failed:', err)
      );

    if (newStatus === JobStatus.COMPLETED) {
      eventsService
        .append({ job_id: jobId, event_type: EventType.JOB_COMPLETED })
        .catch((err) =>
          console.error('[events] JOB_COMPLETED append failed:', err)
        );
    }

    return { job: updatedJob, step };
  },

  async failStep(
    jobId: string,
    stepName: string,
    error: string
  ): Promise<{ job: Job; step: import('../steps/steps.types').JobStep | null }> {
    const job = await jobsRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const [updatedJob, step] = await Promise.all([
      jobsRepository.updateStatus(jobId, JobStatus.FAILED, stepName),
      stepsService.failStep(jobId, stepName, error),
    ]);

    eventsService
      .append({
        job_id: jobId,
        event_type: EventType.STEP_FAILED,
        step_name: stepName,
        payload: { error },
      })
      .catch((err) =>
        console.error('[events] STEP_FAILED append failed:', err)
      );

    eventsService
      .append({ job_id: jobId, event_type: EventType.JOB_FAILED })
      .catch((err) =>
        console.error('[events] JOB_FAILED append failed:', err)
      );

    return { job: updatedJob, step };
  },

  async getJobState(
    jobId: string,
    eventsOptions?: GetEventsOptions & { includeEvents?: boolean }
  ): Promise<JobWithDetails> {
    const job = await jobsRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const steps = await stepsService.getStepsByJobId(jobId);

    const result: JobWithDetails = { ...job, steps };

    if (eventsOptions?.includeEvents !== false) {
      const { events, total } = await eventsService.getByJobId(jobId, eventsOptions);
      result.events = events;
      result.eventsMeta = {
        total,
        limit: eventsOptions?.limit ?? 100,
        offset: eventsOptions?.offset ?? 0,
      };
    }

    return result;
  },
};
