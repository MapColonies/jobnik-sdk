import { type Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import type { ApiClient } from '../api';
import type { components } from '../types/openapi';
import type { JobId, StageId } from '../types/brands';
import type { InferJobData, Job, JobData, NewJob, ValidJobName } from '../types/job';
import type { InferStageData, NewStage, Stage, StageData, ValidStageType } from '../types/stage';
import type { InferTaskData, NewTask, Task } from '../types/task';
import { tracer, withSpan } from '../telemetry/trace';
import {
  ATTR_JOB_MANAGER_JOB_NAME,
  ATTR_JOB_MANAGER_JOB_PRIORITY,
  ATTR_JOB_MANAGER_STAGE_ID,
  ATTR_MESSAGING_BATCH_MESSAGE_COUNT,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_CONVERSATION_ID,
} from '../telemetry/semconv';
import { Logger } from '../types';
import { createAPIErrorFromResponse } from '../errors/utils';
import { JOBNIK_SDK_ERROR_CODES, ProducerError } from '../errors';

const DEFAULT_PRIORITY: Extract<components['schemas']['priority'], 'MEDIUM'> = 'MEDIUM';

/**
 * Client for creating jobs, stages, and tasks in the job management system.
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
 * const producer = new Producer<MyJobTypes, MyStageTypes>(apiClient, logger);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Producer<JobTypes extends { [K in keyof JobTypes]: JobData } = {}, StageTypes extends { [K in keyof StageTypes]: StageData } = {}> {
  /**
   * Creates a new Producer instance.
   *
   * @param apiClient - HTTP client for API communication
   * @param logger - Logger instance for operation tracking
   */
  public constructor(
    private readonly apiClient: ApiClient,
    private readonly logger: Logger
  ) {}

  /**
   * Creates a new job in the system.
   *
   * @template JobName - The job type name, must be a key from JobTypes
   * @param jobData - Job configuration including name, metadata, and data
   * @returns Promise resolving to the created job with assigned ID
   *
   * @throws {ProducerError} When job creation fails
   *
   * @example
   * ```typescript
   * const job = await producer.createJob({
   *   name: 'image-processing',
   *   userMetadata: { userId: 'user-123' },
   *   data: { imageUrl: 'https://example.com/image.jpg' },
   *   priority: 'HIGH'
   * });
   * ```
   */
  public async createJob<JobName extends ValidJobName<JobTypes>>(
    jobData: NewJob<JobName, InferJobData<JobName, JobTypes>>
  ): Promise<Job<JobName, InferJobData<JobName, JobTypes>>> {
    const startTime = performance.now();

    this.logger.debug('Starting job creation', {
      operation: 'createJob',
      jobName: jobData.name,
      priority: jobData.priority ?? DEFAULT_PRIORITY,
    });

    return withSpan(
      `create_job ${jobData.name}`,
      {
        attributes: {
          [ATTR_JOB_MANAGER_JOB_NAME]: jobData.name,
          [ATTR_JOB_MANAGER_JOB_PRIORITY]: jobData.priority ?? DEFAULT_PRIORITY,
        },
        kind: SpanKind.CLIENT,
      },
      this.logger,
      async (span) => {
        propagation.inject(context.active(), jobData);

        const { data, error, response } = await this.apiClient.POST('/jobs', {
          body: jobData,
        });

        if (error !== undefined) {
          throw new ProducerError(
            `Failed to create job ${jobData.name}`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(response, error)
          );
        }

        const duration = performance.now() - startTime;

        this.logger.info('Job created successfully', {
          operation: 'createJob',
          duration,
          status: 'success',
          metadata: {
            jobId: data.id,
            jobName: jobData.name,
            priority: jobData.priority ?? 'MEDIUM',
          },
        });

        span.setAttribute(ATTR_MESSAGING_MESSAGE_CONVERSATION_ID, data.id);
        return data as Job<JobName, InferJobData<JobName, JobTypes>>;
      }
    );
  }

  /**
   * Creates a stage within an existing job.
   *
   * @template StageType - The stage type name, must be a key from StageTypes
   * @param jobId - Branded job ID from a previously created job
   * @param stageData - Stage configuration including type, metadata, and data
   * @returns Promise resolving to the created stage with assigned ID
   *
   * @throws {ProducerError} When job retrieval fails, trace context extraction fails, or stage creation fails
   *
   * @example
   * ```typescript
   * const stage = await producer.createStage(jobId, {
   *   type: 'resize',
   *   userMetadata: { quality: 95 },
   *   data: { width: 800, height: 600 }
   * });
   * ```
   */
  public async createStage<StageType extends ValidStageType<StageTypes>>(
    jobId: JobId,
    stageData: NewStage<StageType, InferStageData<StageType, StageTypes>>
  ): Promise<Stage<StageType, InferStageData<StageType, StageTypes>>> {
    const startTime = performance.now();

    this.logger.debug('Starting stage creation', {
      operation: 'createStage',
      jobId,
      stageType: stageData.type,
    });

    return withSpan(
      `add_stage ${stageData.type}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: jobId,
          [ATTR_MESSAGING_DESTINATION_NAME]: stageData.type,
        },
      },
      this.logger,
      async (span) => {
        const jobResponse = await this.apiClient.GET(`/jobs/{jobId}`, { params: { path: { jobId } } });

        if (jobResponse.error !== undefined) {
          throw new ProducerError(
            `Failed to retrieve job ${jobId}`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(jobResponse.response, jobResponse.error)
          );
        }

        const remoteContext = propagation.extract(context.active(), jobResponse.data);
        const jobSpanContext = trace.getSpanContext(remoteContext);

        if (!jobSpanContext) {
          throw new ProducerError(`Failed to extract span context for job ${jobId}`, JOBNIK_SDK_ERROR_CODES.TRACE_CONTEXT_EXTRACT_ERROR);
        }

        span.addLink({
          context: jobSpanContext,
        });

        propagation.inject(context.active(), jobResponse.data);

        const { data, error, response } = await this.apiClient.POST(`/jobs/{jobId}/stage`, {
          body: stageData,
          params: { path: { jobId } },
        });

        if (error !== undefined) {
          throw new ProducerError(
            `Failed to create stage for job ${jobId}`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(response, error)
          );
        }

        const duration = performance.now() - startTime;

        this.logger.info('Stage created successfully', {
          operation: 'createStage',
          duration,
          status: 'success',
          metadata: {
            jobId,
            stageId: data.id,
            stageType: stageData.type,
          },
        });

        span.setAttribute(ATTR_JOB_MANAGER_STAGE_ID, data.id);
        return data as Stage<StageType, InferStageData<StageType, StageTypes>>;
      }
    );
  }

  /**
   * Creates multiple tasks within an existing stage.
   *
   * @template StageType - The stage type name, must match the stage's actual type
   * @param stageId - Branded stage ID from a previously created stage
   * @param stageType - Stage type name for validation and typing
   * @param taskData - Array of task configurations with metadata and data
   * @returns Promise resolving to array of created tasks with assigned IDs
   *
   * @throws {ProducerError} When task data is empty, stage retrieval fails, stage type mismatch, trace context extraction fails, or task creation fails
   *
   * @example
   * ```typescript
   * const tasks = await producer.createTasks(stageId, 'resize', [
   *   {
   *     userMetadata: { batchId: 'batch-1' },
   *     data: { sourceUrl: 'https://example.com/image1.jpg' }
   *   },
   *   {
   *     userMetadata: { batchId: 'batch-1' },
   *     data: { sourceUrl: 'https://example.com/image2.jpg' }
   *   }
   * ]);
   * ```
   */
  public async createTasks<StageType extends ValidStageType<StageTypes>>(
    stageId: StageId,
    stageType: StageType,
    taskData: NewTask<InferTaskData<StageType, StageTypes>>[]
  ): Promise<Task<InferTaskData<StageType, StageTypes>>[]> {
    if (taskData.length === 0) {
      throw new ProducerError('Task data cannot be empty', JOBNIK_SDK_ERROR_CODES.EMPTY_TASK_DATA_ERROR);
    }

    const startTime = performance.now();

    this.logger.debug('Starting task creation', {
      operation: 'createTasks',
      stageId,
      stageType,
      taskCount: taskData.length,
    });

    return withSpan(
      `send ${stageType}`,
      {
        attributes: {
          [ATTR_JOB_MANAGER_STAGE_ID]: stageId,
          [ATTR_MESSAGING_DESTINATION_NAME]: stageType,
          [ATTR_MESSAGING_BATCH_MESSAGE_COUNT]: taskData.length,
        },
      },
      this.logger,
      async (span) => {
        const producerSpans: Span[] = [];

        const stageResponse = await this.apiClient.GET(`/stages/{stageId}`, { params: { path: { stageId } } });

        if (stageResponse.error !== undefined) {
          throw new ProducerError(
            `Failed to retrieve stage ${stageId}`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(stageResponse.response, stageResponse.error)
          );
        }

        if (stageResponse.data.type !== stageType) {
          this.logger.debug('Stage type validation failed - mismatch detected', {
            operation: 'createTasks',
            stageId,
            clientSpecified: stageType,
            serverReported: stageResponse.data.type,
          });

          throw new ProducerError(
            `Stage type mismatch for stage ${stageId}: server reports '${stageResponse.data.type}', but client specified '${stageType}'`,
            JOBNIK_SDK_ERROR_CODES.STAGE_TYPE_MISMATCH_ERROR
          );
        }

        const remoteContext = propagation.extract(context.active(), stageResponse.data);
        const stageSpanContext = trace.getSpanContext(remoteContext);
        if (!stageSpanContext) {
          throw new ProducerError(`Failed to extract span context for stage ${stageId}`, JOBNIK_SDK_ERROR_CODES.TRACE_CONTEXT_EXTRACT_ERROR);
        }
        span.addLink({
          context: stageSpanContext,
        });

        try {
          const tasksWithTraceContext: components['schemas']['createTaskPayload'][] = [];

          for (const task of taskData) {
            const producerSpan = tracer.startSpan(`create ${stageType}`, { kind: SpanKind.PRODUCER });
            const taskClone = structuredClone(task);

            propagation.inject(trace.setSpan(context.active(), producerSpan), taskClone);

            producerSpans.push(producerSpan);
            tasksWithTraceContext.push(taskClone);
          }

          const { error, data, response } = await this.apiClient.POST(`/stages/{stageId}/tasks`, {
            body: taskData,
            params: { path: { stageId } },
          });

          if (error !== undefined) {
            throw new ProducerError(
              `Failed to create task for stage ${stageId}`,
              JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
              createAPIErrorFromResponse(response, error)
            );
          }

          const duration = performance.now() - startTime;

          this.logger.info('Tasks created successfully', {
            operation: 'createTasks',
            duration,
            status: 'success',
            metadata: {
              stageId,
              stageType,
              taskCount: taskData.length,
              createdTaskCount: data.length,
            },
          });

          return data as Task<InferTaskData<StageType, StageTypes>>[];
        } catch (error) {
          producerSpans.forEach((span) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Parent send operation failed' });
          });
          throw error;
        } finally {
          producerSpans.forEach((span) => span.end());
        }
      }
    );
  }
}
