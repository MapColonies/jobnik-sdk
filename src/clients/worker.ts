import { setTimeout as sleep } from 'node:timers/promises';
import circuitBreaker, { Options as OpossumOptions } from 'opossum';
import { context, propagation, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { ApiClient, ScopedApiClient } from '../api';
import { Logger } from '../types';
import { StageData } from '../types/stage';
import { getErrorMessageFromUnknown, presult } from '../common/utils';
import { Task } from '../types/task';
import {
  ATTR_JOB_MANAGER_STAGE_ID,
  ATTR_MESSAGING_BATCH_MESSAGE_COUNT,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} from '../telemetry/semconv';
import { BASE_ATTRIBUTES, tracer } from '../telemetry/trace';
import { Producer } from './producer';
import { Consumer } from './consumer';

const DEFAULT_PULLING_INTERVAL = 10000;

const defaultCircuitBreakerOptions = {
  enabled: true,
  rollingCountTimeout: 60000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  timeout: false,
  allowWarmUp: true,
} satisfies OpossumOptions;

export type CircuitBreakerOptions = Pick<OpossumOptions, 'enabled' | 'rollingCountTimeout' | 'errorThresholdPercentage' | 'resetTimeout'>;

export interface WorkerOptions {
  concurrency?: number;
  pullingInterval?: number;
  taskHandlerCircuitBreaker?: CircuitBreakerOptions;
  dequeueTaskCircuitBreaker?: CircuitBreakerOptions;
}

export interface TaskHandlerContext {
  signal: AbortSignal;
  logger: Logger;
  producer: Producer;
  apiClient: ScopedApiClient; // Scoped for safety
}

export type TaskHandler = (task: Task, context: TaskHandlerContext) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Worker<StageTypes extends { [K in keyof StageTypes]: StageData } = {}> extends Consumer<StageTypes> {
  private readonly abortController = new AbortController();
  private readonly taskHandlerCircuitBreaker: circuitBreaker<[Task, TaskHandlerContext]>;
  private taskCircuitBreakerPromise: Promise<void> | null = null;
  private taskCircuitBreakerResolve: ((value: void) => void) | null = null;
  private readonly dequeueTaskCircuitBreaker: circuitBreaker<[string], Task | null>;
  private readonly taskHandlerCbResetTimeout: number;

  // queue members
  private isRunning: boolean = false;
  private readonly runningTasks: Set<Promise<void>> = new Set();

  public constructor(
    private readonly taskHandler: TaskHandler,
    private readonly stageType: string,
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

  public async start(): Promise<void> {
    this.logger.info('Starting worker', {
      stageType: this.stageType,
      concurrency: this.options.concurrency ?? 1,
    });

    this.isRunning = true;

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

  public async stop(): Promise<void> {
    this.logger.info('Stopping worker', {
      stageType: this.stageType,
      runningTasks: this.runningTasks.size,
    });

    this.isRunning = false;
    this.abortController.abort('shutdown called');

    await Promise.allSettled(this.runningTasks);
    this.logger.info('Worker stopped', { stageType: this.stageType });
  }

  private runTask(task: Task, span: Span): void {
    this.logger.info('Running task', { taskId: task.id, stageType: this.stageType });
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

          await this.taskHandlerCircuitBreaker.fire(task, taskContext);
          this.logger.debug('Task handler succeeded', { taskId: task.id, stageType: this.stageType });
          await this.markTask('COMPLETED', { task: task, taskId: undefined });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        } catch (error) {
          this.logger.warn('Task handler failed', {
            taskId: task.id,
            stageType: this.stageType,
            error: getErrorMessageFromUnknown(error),
          });

          const [err] = await presult(this.markTask('FAILED', { task: task, taskId: undefined }));

          if (err) {
            this.logger.error('Error occurred while marking task as failed', {
              taskId: task.id,
              stageType: this.stageType,
              error: getErrorMessageFromUnknown(err),
            });
          }

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

        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute(ATTR_MESSAGING_BATCH_MESSAGE_COUNT, 0);
        span.end();
      }

      if (task) {
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
      } else {
        span.setAttribute(ATTR_MESSAGING_BATCH_MESSAGE_COUNT, 0);
        span.end();
      }

      await sleep(this.options.pullingInterval ?? DEFAULT_PULLING_INTERVAL);
    }
  }

  private resolveTaskCircuitBreaker(): void {
    if (this.taskCircuitBreakerResolve) {
      this.taskCircuitBreakerResolve();
      this.taskCircuitBreakerPromise = null;
      this.taskCircuitBreakerResolve = null;
    }
  }

  private setupDequeueCircuitBreaker(): void {
    this.dequeueTaskCircuitBreaker.on('open', () => {
      this.logger.warn('Dequeue task circuit breaker opened', { stageType: this.stageType });
    });

    this.dequeueTaskCircuitBreaker.on('close', () => {
      this.logger.info('Dequeue task circuit breaker closed', { stageType: this.stageType });
    });

    this.dequeueTaskCircuitBreaker.on('halfOpen', () => {
      this.logger.info('Dequeue task circuit breaker half-opened', { stageType: this.stageType });
    });
  }

  private setupTaskHandlerCircuitBreaker(): void {
    this.taskHandlerCircuitBreaker.on('open', () => {
      this.logger.warn('Task handler circuit breaker opened', { stageType: this.stageType });
      this.taskCircuitBreakerPromise = new Promise((resolve) => {
        this.taskCircuitBreakerResolve = resolve;
      });
    });

    this.taskHandlerCircuitBreaker.on('close', () => {
      this.logger.info('Task handler circuit breaker closed', { stageType: this.stageType });
      this.resolveTaskCircuitBreaker();
    });

    this.taskHandlerCircuitBreaker.on('halfOpen', () => {
      this.logger.info('Task handler circuit breaker half-opened', { stageType: this.stageType });
      this.resolveTaskCircuitBreaker();
    });
  }
}
