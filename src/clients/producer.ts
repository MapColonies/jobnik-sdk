import { Span, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import { ApiClient } from '../api';
import { JobId, StageId } from '../types/brands';
import { InferJobData, Job, JobTypesTemplate, NewJob, ValidJobName } from '../types/job';
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
import { InferStageData, NewStage, Stage, StageTypesTemplate, ValidStageType } from '../types/stage';
import { components } from '../types/openapi';

interface JobTypess {
  avi: {
    userMetadata: {
      x: string;
      y: string;
    };
    data: {
      z: string;
      w: string;
    };
  };
  josh: {
    userMetadata: {
      a: string;
      b: string;
    };
    data: {
      c: string;
      d: string;
    };
  };
}

interface TaskTypess {
  nati: {
    userMetadata: {
      e: string;
    };
    data: {
      f: string;
    };
    task: {
      userMetadata: {
        g: string;
      };
      data: {
        h: string;
      };
    };
  };
  daniel: {
    userMetadata: {
      i: string;
    };
    data: {
      j: string;
    };
    task: {
      userMetadata: {
        k: string;
      };
      data: { l: string };
    };
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
class Producer<JobTypes extends JobTypesTemplate = {}, StageTypes extends StageTypesTemplate = {}> {
  public constructor(private readonly apiClient: ApiClient) {}

  public async createJob<JobName extends ValidJobName<JobTypes>>(
    jobData: NewJob<JobName, InferJobData<JobName, JobTypes>>
  ): Promise<Job<JobName, InferJobData<JobName, JobTypes>>> {
    return withSpan(
      `create_job ${jobData.name}`,
      {
        attributes: {
          [ATTR_JOB_MANAGER_JOB_NAME]: jobData.name,
          [ATTR_JOB_MANAGER_JOB_PRIORITY]: jobData.priority ?? 'MEDIUM',
        },
        kind: SpanKind.CLIENT,
      },
      async (span) => {
        propagation.inject(context.active(), jobData);

        const { data, error } = await this.apiClient.POST('/jobs', {
          body: jobData,
        });

        if (error !== undefined) {
          throw new Error(`Failed to create job`);
        }

        span.setAttribute(ATTR_MESSAGING_MESSAGE_CONVERSATION_ID, data.id);
        return data as Job<JobName, JobTypes[JobName]>;
      }
    );
  }

  public async createStage<StageType extends ValidStageType<StageTypes>>(
    jobId: JobId,
    stageData: NewStage<StageType, InferStageData<StageType, StageTypes>>
  ): Promise<Stage<StageType, InferStageData<StageType, StageTypes>>> {
    return withSpan(
      `add_stage ${stageData.type}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: jobId,
          [ATTR_MESSAGING_DESTINATION_NAME]: stageData.type,
        },
      },
      async (span) => {
        const jobResponse = await this.apiClient.GET(`/jobs/{jobId}`, { params: { path: { jobId } } });

        if (jobResponse.error !== undefined) {
          throw new Error(`Failed to retrieve job ${jobId}`, { cause: jobResponse.error });
        }

        const remoteContext = propagation.extract(context.active(), jobResponse.data);
        const jobSpanContext = trace.getSpanContext(remoteContext);

        if (!jobSpanContext) {
          throw new Error(`Failed to extract span context for job ${jobId}`);
        }

        span.addLink({
          context: jobSpanContext,
        });

        propagation.inject(context.active(), jobResponse.data);

        const { data, error } = await this.apiClient.POST(`/jobs/{jobId}/stage`, {
          body: stageData,
          params: { path: { jobId } },
        });

        if (error !== undefined) {
          throw new Error(`Failed to create stage for job ${jobId}`);
        }

        span.setAttribute(ATTR_JOB_MANAGER_STAGE_ID, data.id);
        return data as Stage<StageType, StageTypes[StageType]>;
      }
    );
  }

  public async createTask<StageType extends ValidStageType<StageTypes>>(
    stageId: StageId,
    stageType: StageType,
    taskData: NewTask<InferTaskData<StageType, StageTypes>>[]
  ): Promise<Task<InferTaskData<StageType, StageTypes>>[]> {
    if (taskData.length === 0) {
      throw new Error('Task data cannot be empty');
    }

    return withSpan(
      `send ${stageType}`,
      {
        attributes: {
          [ATTR_JOB_MANAGER_STAGE_ID]: stageId,
          [ATTR_MESSAGING_DESTINATION_NAME]: stageType,
          [ATTR_MESSAGING_BATCH_MESSAGE_COUNT]: taskData.length,
        },
      },
      async (span) => {
        const producerSpans: Span[] = [];

        const stageResponse = await this.apiClient.GET(`/stages/{stageId}`, { params: { path: { stageId } } });

        if (stageResponse.error !== undefined) {
          throw new Error(`Failed to retrieve stage ${stageId}`, { cause: stageResponse.error });
        }

        if (stageResponse.data.type !== stageType) {
          throw new Error(`Stage type mismatch: expected ${stageType}, got ${stageResponse.data.type}`);
        }

        const remoteContext = propagation.extract(context.active(), stageResponse.data);
        const stageSpanContext = trace.getSpanContext(remoteContext);
        if (!stageSpanContext) {
          throw new Error(`Failed to extract span context for stage ${stageId}`);
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

          const { error, data } = await this.apiClient.POST(`/stages/{stageId}/tasks`, {
            body: taskData,
            params: { path: { stageId } },
          });

          if (error !== undefined) {
            throw new Error(`Failed to create task for stage ${stageId}`);
          }

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

// @ts-ignore
const producer = new Producer<JobTypess, TaskTypess>();

void producer.createJob({ name: '', priority: 'MEDIUM', data: {}, userMetadata: { x: 'x', y: 'y' } });

void producer.createStage('aaa' as JobId, {
  type: 'daniel',
  data: { j: 'j' },
  userMetadata: { i: 'i' },
});

void producer.createTask('bbb' as StageId, 'nati', [{ data: { h: 'h' }, userMetadata: { g: 'g' } }]);

void producer.createStage('jobId' as JobId, { data: { j: '' }, type: 'avi', userMetadata: { i: 'ofer' } });
