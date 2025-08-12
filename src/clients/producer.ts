import { Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import { ApiClient } from '../api';
import { JobId, StageId } from '../types/brands';
import { InferJobData, Job, JobData, NewJob, ValidJobName } from '../types/job';
import { InferTaskData, NewTask, Task } from '../types/task';
import { tracer, withSpan } from '../telemetry/trace';
import {
  ATTR_JOB_MANAGER_JOB_NAME,
  ATTR_JOB_MANAGER_JOB_PRIORITY,
  ATTR_JOB_MANAGER_STAGE_ID,
  ATTR_MESSAGING_BATCH_MESSAGE_COUNT,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_CONVERSATION_ID,
} from '../telemetry/semconv';
import { InferStageData, NewStage, Stage, StageData, ValidStageType } from '../types/stage';
import { components } from '../types/openapi';
import { Logger } from '../types';
import { createAPIErrorFromResponse } from '../errors/utils';
import { JOBNIK_SDK_ERROR_CODES, ProducerError } from '../errors';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Producer<JobTypes extends { [K in keyof JobTypes]: JobData } = {}, StageTypes extends { [K in keyof StageTypes]: StageData } = {}> {
  public constructor(
    private readonly apiClient: ApiClient,
    private readonly logger: Logger
  ) {}

  public async createJob<JobName extends ValidJobName<JobTypes>>(
    jobData: NewJob<JobName, InferJobData<JobName, JobTypes>>
  ): Promise<Job<JobName, InferJobData<JobName, JobTypes>>> {
    const startTime = performance.now();

    this.logger.debug('Starting job creation', {
      operation: 'createJob',
      jobName: jobData.name,
      priority: jobData.priority ?? 'MEDIUM',
    });

    return withSpan(
      `create_job ${jobData.name}`,
      {
        attributes: {
          [ATTR_JOB_MANAGER_JOB_NAME]: jobData.name,
          [ATTR_JOB_MANAGER_JOB_PRIORITY]: jobData.priority ?? 'MEDIUM',
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
            await createAPIErrorFromResponse(response, error)
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
            await createAPIErrorFromResponse(jobResponse.response, jobResponse.error)
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
            await createAPIErrorFromResponse(response, error)
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
            await createAPIErrorFromResponse(stageResponse.response, stageResponse.error)
          );
        }

        if (stageResponse.data.type !== stageType) {
          // Log stage type mismatch as it's a validation error that could help debugging
          this.logger.debug('Stage type mismatch detected', {
            operation: 'createTasks',
            stageId,
            expected: stageType,
            actual: stageResponse.data.type,
          });

          throw new ProducerError(
            `Stage type mismatch: expected ${stageType}, got ${stageResponse.data.type}`,
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
              await createAPIErrorFromResponse(response, error)
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
