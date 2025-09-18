import { setTimeout as sleep } from 'node:timers/promises';
import circuitBreaker, { type Options as OpossumOptions } from 'opossum';
import { context, propagation, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ApiClient } from '../api';
import type { Logger } from '../types';
import type { StageData, ValidStageType } from '../types/stage';
import { getErrorMessageFromUnknown, presult } from '../common/utils';
import type { InferTaskData, Task } from '../types/task';
import {
  ATTR_JOB_MANAGER_STAGE_ID,
  ATTR_MESSAGING_BATCH_MESSAGE_COUNT,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} from '../telemetry/semconv';
import { BASE_ATTRIBUTES, tracer } from '../telemetry/trace';
import type { TaskHandler, TaskHandlerContext, WorkerOptions } from '../types/worker';
import { Producer } from './producer';
import { BaseWorker } from './base-worker';

/** Default polling interval in milliseconds for task dequeue operations */
const DEFAULT_POLLING_INTERVAL = 10000;

/** Default circuit breaker configuration with resilient defaults */
const defaultCircuitBreakerOptions = {
  enabled: true,
  rollingCountTimeout: 60000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  timeout: false,
  allowWarmUp: true,
} satisfies OpossumOptions;

/**
 * Production-ready worker for processing tasks from the job management system.
 *
 * Provides concurrent task processing with circuit breaker protection, observability,
 * and graceful shutdown capabilities. Supports configurable concurrency, polling intervals,
 * and failure resilience patterns.
 *
 * Key features:
 * - **Concurrent Processing**: Configurable task concurrency with backpressure handling
 * - **Circuit Breaker Protection**: Separate circuit breakers for task handling and dequeue operations
 * - **Observability**: Comprehensive event emission and distributed tracing support
 * - **Graceful Shutdown**: Coordinated shutdown with running task completion
 * - **Type Safety**: Full TypeScript support with stage-specific task type inference
 *
 * @template StageTypes - Stage type definitions mapping stage names to their data structures
 * @template StageType - Specific stage type this worker processes (must be key of StageTypes)
 *
 * @example
 * ```typescript
 * // Define your stage types
 * interface MyStageTypes {
 *   'image-resize': {
 *     userMetadata: { quality: number };
 *     data: { width: number; height: number };
 *     task: {
 *       userMetadata: { batchId: string };
 *       data: { sourceUrl: string; targetPath: string };
 *     };
 *   };
 * }
 *
 * // Create task handler
 * const taskHandler: TaskHandler<MyStageTypes['image-resize']['task']> = async (task, context) => {
 *   const { sourceUrl, targetPath } = task.data;
 *   const { batchId } = task.userMetadata;
 *
 *   context.logger.info('Processing image resize', { taskId: task.id, batchId });
 *
 *   // Check for cancellation
 *   if (context.signal.aborted) {
 *     throw new Error('Task cancelled during shutdown');
 *   }
 *
 *   // Process image
 *   await resizeImage(sourceUrl, targetPath, task.data.width, task.data.height);
 *
 *   // Create follow-up task
 *   await context.producer.createTask('image-upload', {
 *     data: { processedPath: targetPath, batchId }
 *   });
 * };
 *
 * // Configure worker
 * const worker = new Worker<MyStageTypes, 'image-resize'>(
 *   taskHandler,
 *   'image-resize',
 *   {
 *     concurrency: 5,
 *     pullingInterval: 5000,
 *     taskHandlerCircuitBreaker: {
 *       errorThresholdPercentage: 30,
 *       resetTimeout: 60000
 *     }
 *   },
 *   logger,
 *   apiClient
 * );
 *
 * // Set up monitoring
 * worker.on('taskCompleted', ({ taskId, duration }) => {
 *   console.log(`Task ${taskId} completed in ${duration}ms`);
 * });
 *
 * worker.on('error', ({ location, error }) => {
 *   console.error(`Worker error in ${location}:`, error);
 * });
 *
 * // Start processing
 * await worker.start();
 * ```
 */
export class Worker<
  StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>,
  StageType extends ValidStageType<StageTypes> = string,
> extends BaseWorker<StageTypes> {
  /** Abort controller for coordinated shutdown and task cancellation */
  private readonly abortController = new AbortController();
  /** Circuit breaker protecting task handler execution from failures */
  private readonly taskHandlerCircuitBreaker: circuitBreaker<[Task, TaskHandlerContext]>;
  /** Promise for waiting on task circuit breaker state changes */
  private taskCircuitBreakerPromise: Promise<void> | null = null;
  /** Resolver function for task circuit breaker promise */
  private taskCircuitBreakerResolve: ((value: void) => void) | null = null;
  /** Circuit breaker protecting task dequeue operations from failures */
  private readonly dequeueTaskCircuitBreaker: circuitBreaker<[string], Task | null>;
  /** Timeout duration for task handler circuit breaker reset attempts */
  private readonly taskHandlerCbResetTimeout: number;

  // queue members
  /** Flag indicating if worker is actively processing tasks */
  private isRunning: boolean = false;
  /** Set of currently executing task promises for concurrency management */
  private readonly runningTasks: Set<Promise<void>> = new Set();
  /** Counter for consecutive empty polling attempts (for backoff strategies) */
  private consecutiveEmptyPolls: number = 0;

  /**
   * Creates a new Worker instance with the specified configuration.
   *
   * Sets up circuit breakers, configures polling behavior, and prepares
   * the worker for task processing with the provided handler function.
   *
   * @param taskHandler - Function to process dequeued tasks
   * @param stageType - Stage type to process tasks for
   * @param options - Worker configuration options
   * @param logger - Logger instance for operation tracking
   * @param apiClient - HTTP client for API communication
   *
   * @example
   * ```typescript
   * const worker = new Worker(
   *   async (task, context) => {
   *     // Process task
   *     await processImageResize(task.data);
   *   },
   *   'image-resize',
   *   { concurrency: 3, pullingInterval: 5000 },
   *   logger,
   *   apiClient
   * );
   * ```
   */
  public constructor(
    private readonly taskHandler: TaskHandler<InferTaskData<StageType, StageTypes>>,
    private readonly stageType: StageType,
    private readonly options: WorkerOptions,
    logger: Logger,
    apiClient: ApiClient
  ) {
    super(apiClient, logger);
    this.taskHandlerCircuitBreaker = new circuitBreaker(this.taskHandler, {
      ...defaultCircuitBreakerOptions,
      ...options.taskHandlerCircuitBreaker,
      name: 'taskHandler',
    });

    this.taskHandlerCbResetTimeout = options.taskHandlerCircuitBreaker?.resetTimeout ?? defaultCircuitBreakerOptions.resetTimeout;

    this.setupTaskHandlerCircuitBreaker();

    this.dequeueTaskCircuitBreaker = new circuitBreaker(this.dequeueTask.bind(this), {
      ...defaultCircuitBreakerOptions,
      ...options.dequeueTaskCircuitBreaker,
      name: 'dequeueTask',
    });

    this.setupDequeueCircuitBreaker();
  }

  /**
   * Starts the worker and begins processing tasks from the specified stage.
   *
   * Initiates the task polling loop with configured concurrency limits.
   * The worker will continuously poll for tasks, process them concurrently,
   * and emit events for monitoring and observability.
   *
   * The method implements backpressure by limiting concurrent tasks and waiting
   * for completion when the concurrency limit is reached.
   *
   * @returns Promise that resolves when the worker stops (via stop() call)
   *
   * @fires WorkerEvents#started - When worker begins processing
   * @fires WorkerEvents#taskStarted - When each task begins processing
   * @fires WorkerEvents#taskCompleted - When tasks complete successfully
   * @fires WorkerEvents#taskFailed - When tasks fail during processing
   * @fires WorkerEvents#queueEmpty - When no tasks are available
   * @fires WorkerEvents#error - When errors occur during operation
   *
   * @example
   * ```typescript
   * const worker = new Worker(taskHandler, 'image-resize', options, logger, apiClient);
   *
   * // Set up monitoring
   * worker.on('started', ({ stageType, concurrency }) => {
   *   console.log(`Worker started for ${stageType} with concurrency ${concurrency}`);
   * });
   *
   * // Start processing (this promise resolves when worker stops)
   * await worker.start();
   * ```
   */
  public async start(): Promise<void> {
    this.logger.info('Starting worker', {
      stageType: this.stageType,
      concurrency: this.options.concurrency ?? 1,
    });

    this.isRunning = true;

    this.emit('started', {
      stageType: this.stageType,
      concurrency: this.options.concurrency ?? 1,
    });

    for await (const [task, span] of this.taskIterator()) {
      this.logger.debug('Dequeued task for processing', {
        taskId: task.id,
        runningTasks: this.runningTasks.size,
        stageType: this.stageType,
      });

      this.runTask(task, span);

      while (this.runningTasks.size >= (this.options.concurrency ?? 1)) {
        this.logger.debug('Concurrency limit reached', {
          runningTasks: this.runningTasks.size,
          concurrency: this.options.concurrency ?? 1,
          stageType: this.stageType,
          waiting: true,
        });
        await Promise.race(this.runningTasks);
      }
    }
  }

  /**
   * Gracefully stops the worker and waits for running tasks to complete.
   *
   * Initiates shutdown by setting the running flag to false, aborting the
   * cancellation signal, and waiting for all currently running tasks to finish.
   * Provides clean shutdown coordination for production deployments.
   *
   * @returns Promise that resolves when all tasks complete and worker fully stops
   *
   * @fires WorkerEvents#stopping - When shutdown begins
   * @fires WorkerEvents#stopped - When worker fully stops
   *
   * @example
   * ```typescript
   * // Graceful shutdown on SIGTERM
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down worker...');
   *   await worker.stop();
   *   console.log('Worker stopped');
   *   process.exit(0);
   * });
   * ```
   */
  public override async stop(): Promise<void> {
    this.emit('stopping', {
      stageType: this.stageType,
      runningTasks: this.runningTasks.size,
    });

    this.logger.info('Stopping worker', {
      stageType: this.stageType,
      runningTasks: this.runningTasks.size,
    });

    this.isRunning = false;
    await super.stop();
    this.abortController.abort('shutdown called');

    await Promise.allSettled(this.runningTasks);

    this.logger.info('Worker stopped', { stageType: this.stageType });

    this.emit('stopped', { stageType: this.stageType });
  }

  /**
   * Executes a single task with proper error handling and observability.
   *
   * Wraps task execution with distributed tracing, error handling, and status updates.
   * Handles task completion/failure status updates and emits appropriate events.
   *
   * This method is called internally by the task processing loop and should not
   * be called directly by user code.
   *
   * @param task - Task to execute
   * @param span - OpenTelemetry span for distributed tracing
   *
   * @internal
   */
  private runTask(task: Task, span: Span): void {
    this.logger.info('Running task', { taskId: task.id, stageType: this.stageType });

    this.emit('taskStarted', { taskId: task.id, stageType: this.stageType });

    const taskContext = {
      signal: this.abortController.signal,
      logger: this.logger,
      producer: new Producer(this.apiClient, this.logger),
      apiClient: this.apiClient,
    };

    const wrapHandler = async (): Promise<void> => {
      const ctx = trace.setSpan(context.active(), span);
      await context.with(ctx, async () => {
        try {
          this.logger.debug('Task handler firing', {
            taskId: task.id,
            stageType: this.stageType,
          });

          const startTime = performance.now();

          await this.taskHandlerCircuitBreaker.fire(task, taskContext);
          this.logger.debug('Task handler succeeded', { taskId: task.id, stageType: this.stageType });
          await this.markTask('COMPLETED', { task, taskId: undefined });

          this.emit('taskCompleted', { taskId: task.id, stageType: this.stageType, duration: performance.now() - startTime });

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          this.logger.warn('Task handler failed', {
            taskId: task.id,
            stageType: this.stageType,
            error: getErrorMessageFromUnknown(error),
          });

          const [err] = await presult(this.markTask('FAILED', { task, taskId: undefined }));

          if (err) {
            this.logger.error('Error occurred while marking task as failed', {
              taskId: task.id,
              stageType: this.stageType,
              error: getErrorMessageFromUnknown(err),
            });

            this.emit('error', {
              location: 'markTaskFailed',
              error: err,
              stageType: this.stageType,
            });
          }

          this.emit('taskFailed', {
            taskId: task.id,
            stageType: this.stageType,
            error: error,
          });

          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        }
      });
    };

    const taskPromise = wrapHandler()
      .catch((error) => {
        this.logger.error('Error occurred while processing task', {
          taskId: task.id,
          stageType: this.stageType,
          error: getErrorMessageFromUnknown(error),
        });

        this.emit('error', {
          location: 'taskProcessing',
          error: error,
          stageType: this.stageType,
        });
      })
      .finally(() => {
        this.logger.debug('Task promise finished', {
          taskId: task.id,
          stageType: this.stageType,
          runningTasks: this.runningTasks.size,
        });
        this.runningTasks.delete(taskPromise);
      });

    this.runningTasks.add(taskPromise);
  }

  /**
   * Async generator that yields tasks from the job management system.
   *
   * Implements the core polling loop with circuit breaker protection,
   * distributed tracing, and empty queue handling. Continues until
   * the worker is stopped via the stop() method.
   *
   * The iterator handles:
   * - Circuit breaker coordination for resilient polling
   * - Distributed trace context extraction and linking
   * - Empty queue detection and backoff timing
   * - Error handling with proper span recording
   *
   * @yields Tuple of [Task, Span] for each available task
   *
   * @internal
   */
  private async *taskIterator(): AsyncGenerator<[Task, Span]> {
    while (this.isRunning) {
      if (this.taskCircuitBreakerPromise) {
        this.logger.debug('Waiting for task circuit breaker', {
          stageType: this.stageType,
        });

        await Promise.race([this.taskCircuitBreakerPromise, sleep(this.taskHandlerCbResetTimeout)]);
      }

      const span = tracer.startSpan(`process ${this.stageType}`, {
        root: true,
        kind: SpanKind.CONSUMER,
        attributes: {
          [ATTR_MESSAGING_DESTINATION_NAME]: this.stageType,
          ...BASE_ATTRIBUTES,
        },
      });

      const ctx = trace.setSpan(context.active(), span);

      const [err, task] = await context.with(ctx, async () => presult(this.dequeueTaskCircuitBreaker.fire(this.stageType)));

      if (err) {
        this.logger.debug('Error while dequeuing task', {
          stageType: this.stageType,
          error: getErrorMessageFromUnknown(err),
        });

        this.emit('error', {
          location: 'taskDequeue',
          error: err,
          stageType: this.stageType,
        });

        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute(ATTR_MESSAGING_BATCH_MESSAGE_COUNT, 0);
        span.end();
      }

      if (task) {
        this.consecutiveEmptyPolls = 0;

        this.logger.debug('Yielding task from iterator', {
          taskId: task.id,
          stageType: this.stageType,
        });

        const remoteContext = propagation.extract(context.active(), task);
        const taskSpanContext = trace.getSpanContext(remoteContext);

        if (taskSpanContext) {
          span.addLink({ context: taskSpanContext });
        }

        span.setAttributes({
          [ATTR_JOB_MANAGER_STAGE_ID]: task.stageId,
          [ATTR_MESSAGING_MESSAGE_ID]: task.id,
        });

        yield [task, span];
        continue;
      } else {
        this.consecutiveEmptyPolls++;

        this.emit('queueEmpty', {
          stageType: this.stageType,
          consecutiveEmptyPolls: this.consecutiveEmptyPolls,
        });

        span.setAttribute(ATTR_MESSAGING_BATCH_MESSAGE_COUNT, 0);
        span.end();
      }

      await sleep(this.options.pullingInterval ?? DEFAULT_POLLING_INTERVAL);
    }
  }

  /**
   * Resolves the task circuit breaker promise to unblock task processing.
   *
   * Called when the task handler circuit breaker transitions from open
   * to half-open or closed state, allowing task processing to resume.
   *
   * @internal
   */
  private resolveTaskCircuitBreaker(): void {
    if (this.taskCircuitBreakerResolve) {
      this.taskCircuitBreakerResolve();
      this.taskCircuitBreakerPromise = null;
      this.taskCircuitBreakerResolve = null;
    }
  }

  /**
   * Sets up event handlers for the dequeue task circuit breaker.
   *
   * Configures logging and event emission for circuit breaker state changes
   * during task dequeue operations. Provides visibility into dequeue failures
   * and recovery patterns.
   *
   * @internal
   */
  private setupDequeueCircuitBreaker(): void {
    this.dequeueTaskCircuitBreaker.on('open', () => {
      this.logger.warn('Dequeue task circuit breaker opened', { stageType: this.stageType });

      this.emit('circuitBreakerOpened', {
        breaker: 'dequeueTask',
        stageType: this.stageType,
      });
    });

    this.dequeueTaskCircuitBreaker.on('close', () => {
      this.logger.info('Dequeue task circuit breaker closed', { stageType: this.stageType });

      this.emit('circuitBreakerClosed', {
        breaker: 'dequeueTask',
        stageType: this.stageType,
      });
    });

    this.dequeueTaskCircuitBreaker.on('halfOpen', () => {
      this.logger.info('Dequeue task circuit breaker half-opened', { stageType: this.stageType });
    });
  }

  /**
   * Sets up event handlers for the task handler circuit breaker.
   *
   * Configures logging, event emission, and promise coordination for circuit breaker
   * state changes during task handler execution. Manages the task circuit breaker
   * promise that blocks task processing when the circuit breaker is open.
   *
   * @internal
   */
  private setupTaskHandlerCircuitBreaker(): void {
    this.taskHandlerCircuitBreaker.on('open', () => {
      this.logger.warn('Task handler circuit breaker opened', { stageType: this.stageType });

      this.emit('circuitBreakerOpened', {
        breaker: 'taskHandler',
        stageType: this.stageType,
      });

      this.taskCircuitBreakerPromise = new Promise((resolve) => {
        this.taskCircuitBreakerResolve = resolve;
      });
    });

    this.taskHandlerCircuitBreaker.on('close', () => {
      this.logger.info('Task handler circuit breaker closed', { stageType: this.stageType });

      this.emit('circuitBreakerClosed', {
        breaker: 'taskHandler',
        stageType: this.stageType,
      });

      this.resolveTaskCircuitBreaker();
    });

    this.taskHandlerCircuitBreaker.on('halfOpen', () => {
      this.logger.info('Task handler circuit breaker half-opened', { stageType: this.stageType });
      this.resolveTaskCircuitBreaker();
    });
  }
}
