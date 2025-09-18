import type { Options as OpossumOptions } from 'opossum';
import type { Logger } from '../telemetry/logger';
import type { ScopedApiClient } from '../api';
import type { Task, TaskData } from './task';
import type { TaskId } from './brands';
import type { StageData } from './stage';
import type { IProducer } from './producer';
import type { JobData } from './job';

/**
 * Configuration options for circuit breaker behavior.
 * Subset of Opossum circuit breaker options for task processing resilience.
 */
export type CircuitBreakerOptions = Pick<OpossumOptions, 'enabled' | 'rollingCountTimeout' | 'errorThresholdPercentage' | 'resetTimeout'>;

/**
 * Configuration options for worker behavior and performance tuning.
 *
 * @example
 * ```typescript
 * const options: WorkerOptions = {
 *   concurrency: 5,
 *   pullingInterval: 5000,
 *   taskHandlerCircuitBreaker: {
 *     enabled: true,
 *     errorThresholdPercentage: 50
 *   }
 * };
 * ```
 */
export interface WorkerOptions {
  /** Maximum number of tasks to process concurrently. @defaultValue 1 */
  concurrency?: number;
  /** Interval in milliseconds between task dequeue attempts. @defaultValue 10000 */
  pullingInterval?: number;
  /** Circuit breaker configuration for task handler execution */
  taskHandlerCircuitBreaker?: CircuitBreakerOptions;
  /** Circuit breaker configuration for task dequeue operations */
  dequeueTaskCircuitBreaker?: CircuitBreakerOptions;
}

/**
 * Context object provided to task handlers with execution utilities.
 * Contains cancellation signal, logging, and API access for task processing.
 *
 * @example
 * ```typescript
 * const taskHandler: TaskHandler<MyTaskData> = async (task, context) => {
 *   context.logger.info('Processing task', { taskId: task.id });
 *
 *   // Check for cancellation
 *   if (context.signal.aborted) {
 *     throw new Error('Task cancelled');
 *   }
 *
 *   // Create follow-up tasks
 *   await context.producer.createTask('next-stage', { data: result });
 * };
 * ```
 */
export interface TaskHandlerContext<
  JobTypes extends { [K in keyof JobTypes]: JobData } = Record<string, JobData>,
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
> {
  /** Cancellation signal that aborts when worker stops */
  signal: AbortSignal;
  /** Logger instance for task processing operations */
  logger: Logger;
  /** Producer client for creating follow-up tasks */
  producer: IProducer<JobTypes, StageTypes>;
  /** Scoped API client for safe task operations */
  apiClient: ScopedApiClient; // Scoped for safety
}

/**
 * Function signature for processing tasks of a specific type.
 * Called by workers when tasks are dequeued from the job management system.
 *
 * @template TaskPayload - Task data structure including userMetadata and data fields
 * @param task - The task to process with typed payload
 * @param context - Execution context with utilities and cancellation support
 * @returns Promise that resolves when task processing is complete
 *
 * @example
 * ```typescript
 * interface ImageResizeTask {
 *   userMetadata: { quality: number };
 *   data: { sourceUrl: string; width: number; height: number };
 * }
 *
 * const resizeHandler: TaskHandler<ImageResizeTask> = async (task, context) => {
 *   const { sourceUrl, width, height } = task.data;
 *   const { quality } = task.userMetadata;
 *
 *   // Process the image resize
 *   const result = await resizeImage(sourceUrl, width, height, quality);
 *
 *   // Create next task in pipeline
 *   await context.producer.createTask('upload-stage', {
 *     data: { processedUrl: result.url }
 *   });
 * };
 * ```
 */
export type TaskHandler<
  TaskPayload extends TaskData,
  JobTypes extends { [K in keyof JobTypes]: JobData } = Record<string, JobData>,
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
> = (task: Task<TaskPayload>, context: TaskHandlerContext<JobTypes, StageTypes>) => Promise<void>;

/**
 * Event data types emitted by worker instances during task processing.
 * Provides comprehensive monitoring and observability for worker operations.
 */
export interface WorkerEvents {
  /** Emitted when worker starts task processing */
  started: { stageType: string; concurrency: number };
  /** Emitted when worker fully stops and cleans up */
  stopped: { stageType: string };
  /** Emitted when worker begins shutdown process */
  stopping: { stageType: string; runningTasks: number };
  /** Emitted when a task begins processing */
  taskStarted: { taskId: TaskId; stageType: string };
  /** Emitted when a task completes successfully */
  taskCompleted: { taskId: TaskId; stageType: string; duration: number };
  /** Emitted when a task fails during processing */
  taskFailed: { taskId: TaskId; stageType: string; error: unknown };
  /** Emitted when errors occur in worker operations */
  error: { location: string; error: unknown; stageType: string };
  /** Emitted when circuit breakers open due to failures */
  circuitBreakerOpened: { breaker: 'taskHandler' | 'dequeueTask'; stageType: string };
  /** Emitted when circuit breakers close after recovery */
  circuitBreakerClosed: { breaker: 'taskHandler' | 'dequeueTask'; stageType: string };
  /** Emitted when task queue is empty during polling */
  queueEmpty: { stageType: string; consecutiveEmptyPolls: number };
}

/**
 * Interface for Worker instances that process tasks from the job management system.
 * Provides concurrent task processing with circuit breaker protection, observability,
 * and graceful shutdown capabilities.
 *
 * @template StageTypes - Stage type definitions mapping stage names to their data structures
 * @template StageType - Specific stage type this worker processes (must be key of StageTypes)
 */
export interface IWorker<
  // StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
  // // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // StageType extends ValidStageType<StageTypes> = string,
> {
  /**
   * Starts the worker and begins processing tasks from the specified stage.
   * @returns Promise that resolves when the worker stops (via stop() call)
   */
  start: () => Promise<void>;

  /**
   * Gracefully stops the worker and waits for running tasks to complete.
   * @returns Promise that resolves when all tasks complete and worker fully stops
   */
  stop: () => Promise<void>;

  /**
   * Registers an event listener for the specified worker event.
   * @param event - Name of the event to listen for
   * @param listener - Function to call when event is emitted
   * @returns This worker instance for method chaining
   */
  on: <K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void) => this;

  /**
   * Removes an event listener for the specified worker event.
   * @param event - Name of the event to stop listening for
   * @param listener - Function to remove from event listeners
   * @returns This worker instance for method chaining
   */
  off: <K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void) => this;

  /**
   * Registers a one-time event listener for the specified worker event.
   * @param event - Name of the event to listen for once
   * @param listener - Function to call when event is first emitted
   * @returns This worker instance for method chaining
   */
  once: <K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void) => this;

  /**
   * Removes all listeners for a specific event or all events.
   * @param event - Optional event name to remove listeners for (removes all if not specified)
   * @returns This worker instance for method chaining
   */
  removeAllListeners: <K extends keyof WorkerEvents>(event?: K) => this;
}
