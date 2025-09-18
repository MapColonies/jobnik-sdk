import type { JobId, StageId } from './brands';
import type { InferJobData, Job, JobData, NewJob, ValidJobName } from './job';
import type { InferStageData, NewStage, Stage, StageData, ValidStageType } from './stage';
import type { InferTaskData, NewTask, Task } from './task';

/**
 * Interface for Producer instances that create jobs, stages, and tasks in the job management system.
 *
 * @template JobTypes - Interface defining job types with their metadata and data schemas
 * @template StageTypes - Interface defining stage types with their metadata, data, and task schemas
 */
export interface IProducer<
  JobTypes extends { [K in keyof JobTypes]: JobData } = Record<string, JobData>,
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
> {
  /**
   * Creates a new job in the system.
   * @param jobData - Job configuration including name, metadata, and data
   * @returns Promise resolving to the created job with assigned ID
   */
  createJob: <JobName extends ValidJobName<JobTypes>>(
    jobData: NewJob<JobName, InferJobData<JobName, JobTypes>>
  ) => Promise<Job<JobName, InferJobData<JobName, JobTypes>>>;

  /**
   * Creates a stage within an existing job.
   * @param jobId - Branded job ID from a previously created job
   * @param stageData - Stage configuration including type, metadata, and data
   * @returns Promise resolving to the created stage with assigned ID
   */
  createStage: <StageType extends ValidStageType<StageTypes>>(
    jobId: JobId,
    stageData: NewStage<StageType, InferStageData<StageType, StageTypes>>
  ) => Promise<Stage<StageType, InferStageData<StageType, StageTypes>>>;

  /**
   * Creates multiple tasks within an existing stage.
   * @param stageId - Branded stage ID from a previously created stage
   * @param stageType - Stage type name for validation and typing
   * @param taskData - Array of task configurations with metadata and data
   * @returns Promise resolving to array of created tasks with assigned IDs
   */
  createTasks: <StageType extends ValidStageType<StageTypes>>(
    stageId: StageId,
    stageType: StageType,
    taskData: NewTask<InferTaskData<StageType, StageTypes>>[]
  ) => Promise<Task<InferTaskData<StageType, StageTypes>>[]>;
}
