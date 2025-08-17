import { SpanKind, context, propagation, trace, type Span } from '@opentelemetry/api';
import { StatusCodes } from 'http-status-codes';
import type { ApiClient } from '../api';
import type { TaskId } from '../types/brands';
import type { InferTaskData, Task } from '../types/task';
import type { ValidStageType, StageData } from '../types/stage';
import type { components } from '../types/openapi';
import { withSpan } from '../telemetry/trace';
import { JOB_MANAGER_TASK_ATTEMPTS, JOB_MANAGER_TASK_STATUS, ATTR_MESSAGING_DESTINATION_NAME, ATTR_MESSAGING_MESSAGE_ID } from '../telemetry/semconv';
import { Logger } from '../types';
import { createAPIErrorFromResponse } from '../errors/utils';
import { JOBNIK_SDK_ERROR_CODES, ConsumerError } from '../errors';

/**
 * Client for consuming and processing tasks from the job management system.
 * Supports dequeueing tasks and updating their status to completed or failed.
 *
 * @template StageTypes - Interface defining stage types with their metadata, data, and task schemas
 *
 * @example
 * ```typescript
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
 * const consumer = new Consumer<MyStageTypes>(apiClient, logger);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Consumer<StageTypes extends { [K in keyof StageTypes]: StageData } = {}> {
  /**
   * Creates a new Consumer instance.
   *
   * @param apiClient - HTTP client for API communication
   * @param logger - Logger instance for operation tracking
   */
  public constructor(
    private readonly apiClient: ApiClient,
    private readonly logger: Logger
  ) {}

  /**
   * Dequeues the highest priority pending task of the specified stage type.
   * The task status is automatically updated to IN_PROGRESS upon successful dequeue.
   *
   * @template StageType - The stage type name, must be a key from StageTypes
   * @param stageType - Stage type to dequeue tasks from
   * @returns Promise resolving to the dequeued task, or null if no tasks are available
   *
   * @throws {ConsumerError} When dequeue operation fails or trace context extraction fails
   *
   * @example
   * ```typescript
   * const task = await consumer.dequeueTask('resize');
   * if (task) {
   *   // Process the task
   *   console.log('Processing task:', task.id);
   * } else {
   *   console.log('No tasks available');
   * }
   * ```
   */
  public async dequeueTask<StageType extends ValidStageType<StageTypes>>(
    stageType: StageType
  ): Promise<Task<InferTaskData<StageType, StageTypes>> | null> {
    const startTime = performance.now();

    this.logger.debug('Starting task dequeue', {
      operation: 'dequeueTask',
      stageType,
    });

    return withSpan(
      `receive ${stageType}`,
      {
        attributes: {
          [ATTR_MESSAGING_DESTINATION_NAME]: stageType,
        },
        kind: SpanKind.CLIENT,
      },
      this.logger,
      async (span) => {
        const { data, error, response } = await this.apiClient.PATCH('/stages/{stageType}/tasks/dequeue', {
          params: { path: { stageType } },
        });

        // Handle 404 as expected behavior when no tasks are available
        if (response.status === (StatusCodes.NOT_FOUND as number)) {
          const duration = performance.now() - startTime;
          this.logger.debug('No tasks available for dequeue', {
            operation: 'dequeueTask',
            duration,
            stageType,
          });
          return null;
        }

        if (error !== undefined) {
          throw new ConsumerError(
            `Failed to dequeue task for stage type ${stageType}`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(response, error)
          );
        }

        const duration = performance.now() - startTime;

        this.logger.info('Task dequeued successfully', {
          operation: 'dequeueTask',
          duration,
          status: 'success',
          metadata: {
            taskId: data.id,
            stageType,
            attempts: data.attempts,
          },
        });

        span.setAttributes({
          [ATTR_MESSAGING_MESSAGE_ID]: data.id,
          [JOB_MANAGER_TASK_ATTEMPTS]: data.attempts,
        });

        return data as Task<InferTaskData<StageType, StageTypes>>;
      }
    );
  }

  /**
   * Marks a task as completed by updating its status.
   * Creates a CLIENT span with proper trace linking to the original task creation.
   *
   * @param taskId - Branded task ID to mark as completed
   * @returns Promise that resolves when the status update is complete
   *
   * @throws {ConsumerError} When task retrieval fails, trace context extraction fails, or status update fails
   *
   * @example
   * ```typescript
   * await consumer.markTaskCompleted(taskId);
   * ```
   */
  public async markTaskCompleted(taskId: TaskId): Promise<void> {
    const startTime = performance.now();

    this.logger.debug('Marking task as completed', {
      operation: 'markTaskCompleted',
      taskId,
    });

    return withSpan(
      'update_status',
      {
        attributes: {
          [ATTR_MESSAGING_MESSAGE_ID]: taskId,
          [JOB_MANAGER_TASK_STATUS]: 'COMPLETED',
        },
        kind: SpanKind.CLIENT,
      },
      this.logger,
      async (span) => {
        // Fetch task for validation and trace context
        const taskResponse = await this.apiClient.GET('/tasks/{taskId}', {
          params: { path: { taskId } },
        });

        if (taskResponse.error !== undefined) {
          throw new ConsumerError(
            `Failed to retrieve task ${taskId} for status update`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(taskResponse.response, taskResponse.error)
          );
        }

        await this.markTaskCompletedWithTask(taskResponse.data, span, startTime);
      }
    );
  }

  /**
   * Marks a task as failed by updating its status.
   * Creates a CLIENT span with proper trace linking to the original task creation.
   *
   * @param taskId - Branded task ID to mark as failed
   * @returns Promise that resolves when the status update is complete
   *
   * @throws {ConsumerError} When task retrieval fails, trace context extraction fails, or status update fails
   *
   * @example
   * ```typescript
   * await consumer.markTaskFailed(taskId);
   * ```
   */
  public async markTaskFailed(taskId: TaskId): Promise<void> {
    const startTime = performance.now();

    this.logger.debug('Marking task as failed', {
      operation: 'markTaskFailed',
      taskId,
    });

    return withSpan(
      'update_status',
      {
        attributes: {
          [ATTR_MESSAGING_MESSAGE_ID]: taskId,
          [JOB_MANAGER_TASK_STATUS]: 'FAILED',
        },
        kind: SpanKind.CLIENT,
      },
      this.logger,
      async (span) => {
        // Fetch task for validation and trace context
        const taskResponse = await this.apiClient.GET('/tasks/{taskId}', {
          params: { path: { taskId } },
        });

        if (taskResponse.error !== undefined) {
          throw new ConsumerError(
            `Failed to retrieve task ${taskId} for status update`,
            JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
            createAPIErrorFromResponse(taskResponse.response, taskResponse.error)
          );
        }

        await this.markTaskFailedWithTask(taskResponse.data, span, startTime);
      }
    );
  }

  /**
   * Marks a task as completed using an existing task object.
   * Avoids unnecessary API calls when the task is already available.
   *
   * @private
   * @param task - Task object to mark as completed
   * @param span - Current span for tracing
   * @param startTime - Start time for duration calculation
   * @returns Promise that resolves when the status update is complete
   */
  private async markTaskCompletedWithTask(task: components['schemas']['taskResponse'], span: Span, startTime: number): Promise<void> {
    // Extract trace context and link to original create span
    const remoteContext = propagation.extract(context.active(), task);
    const taskSpanContext = trace.getSpanContext(remoteContext);

    if (!taskSpanContext) {
      throw new ConsumerError(`Failed to extract span context for task ${task.id}`, JOBNIK_SDK_ERROR_CODES.TRACE_CONTEXT_EXTRACT_ERROR);
    }

    // Validate task is in correct state for completion
    if (task.status !== 'IN_PROGRESS') {
      throw new ConsumerError(
        `Cannot mark task ${task.id} as completed: task is in ${task.status} state, expected IN_PROGRESS`,
        JOBNIK_SDK_ERROR_CODES.TASK_INVALID_STATE_TRANSITION
      );
    }

    span.addLink({
      context: taskSpanContext,
    });

    const { error, response } = await this.apiClient.PUT('/tasks/{taskId}/status', {
      params: { path: { taskId: task.id } },
      body: { status: 'COMPLETED' },
    });

    if (error !== undefined) {
      throw new ConsumerError(
        `Failed to mark task ${task.id} as completed`,
        JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
        createAPIErrorFromResponse(response, error)
      );
    }

    const duration = performance.now() - startTime;

    this.logger.info('Task marked as completed', {
      operation: 'markTaskCompleted',
      duration,
      status: 'success',
      metadata: {
        taskId: task.id,
      },
    });
  }

  /**
   * Marks a task as failed using an existing task object.
   * Avoids unnecessary API calls when the task is already available.
   *
   * @private
   * @param task - Task object to mark as failed
   * @param span - Current span for tracing
   * @param startTime - Start time for duration calculation
   * @returns Promise that resolves when the status update is complete
   */
  private async markTaskFailedWithTask(task: components['schemas']['taskResponse'], span: Span, startTime: number): Promise<void> {
    // Extract trace context and link to original create span
    const remoteContext = propagation.extract(context.active(), task);
    const taskSpanContext = trace.getSpanContext(remoteContext);

    if (!taskSpanContext) {
      throw new ConsumerError(`Failed to extract span context for task ${task.id}`, JOBNIK_SDK_ERROR_CODES.TRACE_CONTEXT_EXTRACT_ERROR);
    }

    // Validate task is in correct state for failure
    if (task.status !== 'IN_PROGRESS') {
      throw new ConsumerError(
        `Cannot mark task ${task.id} as failed: task is in ${task.status} state, expected IN_PROGRESS`,
        JOBNIK_SDK_ERROR_CODES.TASK_INVALID_STATE_TRANSITION
      );
    }

    span.addLink({
      context: taskSpanContext,
    });

    const { error, response } = await this.apiClient.PUT('/tasks/{taskId}/status', {
      params: { path: { taskId: task.id } },
      body: { status: 'FAILED' },
    });

    if (error !== undefined) {
      throw new ConsumerError(
        `Failed to mark task ${task.id} as failed`,
        JOBNIK_SDK_ERROR_CODES.REQUEST_FAILED_ERROR,
        createAPIErrorFromResponse(response, error)
      );
    }

    const duration = performance.now() - startTime;

    this.logger.info('Task marked as failed', {
      operation: 'markTaskFailed',
      duration,
      status: 'success',
      metadata: {
        taskId: task.id,
      },
    });
  }
}
