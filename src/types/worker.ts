import type { Options as OpossumOptions } from 'opossum';
import type { Logger } from '../telemetry/logger';
import type { Producer } from '../clients';
import type { ScopedApiClient } from '../api';
import type { Task, TaskData } from './task';
import type { TaskId } from './brands';

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
export interface TaskHandlerContext {
  /** Cancellation signal that aborts when worker stops */
  signal: AbortSignal;
  /** Logger instance for task processing operations */
  logger: Logger;
  /** Producer client for creating follow-up tasks */
  producer: Producer;
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
export type TaskHandler<TaskPayload extends TaskData> = (task: Task<TaskPayload>, context: TaskHandlerContext) => Promise<void>;

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
