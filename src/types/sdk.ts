import { IConsumer } from './consumer';
import { JobData } from './job';
import { IProducer } from './producer';
import { StageData, ValidStageType } from './stage';
import { InferTaskData } from './task';
import { IWorker, TaskHandler, WorkerOptions } from './worker';

/**
 * Main interface for the Jobnik SDK providing access to job management clients.
 * Central API for creating jobs, consuming tasks, and managing worker processes.
 *
 * @template JobTypes - Interface defining job types with their metadata and data schemas
 * @template StageTypes - Interface defining stage types with their metadata, data, and task schemas
 *
 * @example
 * ```typescript
 * interface MyJobTypes {
 *   'image-processing': {
 *     userMetadata: { userId: string };
 *     data: { imageUrl: string };
 *   };
 * }
 *
 * interface MyStageTypes {
 *   'resize': {
 *     userMetadata: { quality: number };
 *     data: { width: number; height: number };
 *     task: {
 *       userMetadata: { batchId: string };
 *       data: { sourceUrl: string };
 *     };
 *   };
 * }
 *
 * const sdk: IJobnikSDK<MyJobTypes, MyStageTypes> = new JobnikSDK({
 *   baseUrl: 'https://api.example.com'
 * });
 * ```
 */
export interface IJobnikSDK<
  JobTypes extends { [K in keyof JobTypes]: JobData } = Record<string, JobData>,
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
> {
  /**
   * Gets a consumer client for dequeueing and processing tasks.
   * @returns Consumer instance for task consumption operations
   */
  getConsumer: () => IConsumer<StageTypes>;

  /**
   * Gets a producer client for creating jobs, stages, and tasks.
   * @returns Producer instance for job creation operations
   */
  getProducer: () => IProducer<JobTypes, StageTypes>;

  /**
   * Creates a worker instance to continuously process tasks of a specific stage type.
   *
   * @template StageType - The stage type this worker will process
   * @param taskHandler - Function to handle individual task processing
   * @param stageType - Stage type name to process tasks for
   * @param options - Optional worker configuration (concurrency, intervals, circuit breakers)
   * @returns Worker instance for continuous task processing
   *
   * @example
   * ```typescript
   * const worker = sdk.createWorker(
   *   async (task, context) => {
   *     context.logger.info('Processing task', { taskId: task.id });
   *     // Process task data...
   *   },
   *   'resize',
   *   { concurrency: 3, pullingInterval: 5000 }
   * );
   * ```
   */
  createWorker: <StageType extends ValidStageType<StageTypes> = string>(
    taskHandler: TaskHandler<InferTaskData<StageType, StageTypes>, JobTypes, StageTypes>,
    stageType: StageType,
    options?: WorkerOptions
  ) => IWorker;
}
