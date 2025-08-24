import { setTimeout as sleep } from 'node:timers/promises';
import circuitBreaker from 'opossum';
import { ApiClient, ScopedApiClient } from '../api';
import { Logger } from '../types';
import { StageData } from '../types/stage';
import { getErrorMessageFromUnknown, presult } from '../common/utils';
import { Task } from '../types/task';
import { Producer } from './producer';
import { Consumer } from './consumer';

export interface WorkerOptions {
  concurrency?: number;
  pullingInterval?: number;
}

export interface TaskHandlerContext {
  signal: AbortSignal;
  logger: Logger;
  producer: Producer;
  apiClient: ScopedApiClient; // Scoped for safety
}

export type TaskHandler = (task: Task, context: TaskHandlerContext) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Worker<StageTypes extends { [K in keyof StageTypes]: StageData } = {}> {
  private readonly abortController = new AbortController();
  private readonly taskHandlerCircuitBreaker: circuitBreaker<[Task, TaskHandlerContext]>;
  private taskCircuitBreakerPromise: Promise<void> | null = null;
  private taskCircuitBreakerResolve: ((value: void) => void) | null = null;
  private readonly dequeueTaskCircuitBreaker: circuitBreaker<[string], Task | null>;

  // queue members
  private isRunning: boolean = false;
  private readonly runningTasks: Set<Promise<void>> = new Set();

  public constructor(
    private readonly taskHandler: TaskHandler,
    private readonly options: WorkerOptions,
    private readonly logger: Logger,
    private readonly apiClient: ApiClient,
    private readonly consumer: Consumer,
    private readonly stageType: string
  ) {
    this.taskHandlerCircuitBreaker = new circuitBreaker(this.taskHandler, {
      timeout: 6000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'taskHandler',
    });

    this.setupTaskHandlerCircuitBreaker();

    this.dequeueTaskCircuitBreaker = new circuitBreaker(this.consumer.dequeueTask.bind(this), {
      name: 'dequeueTask',
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });

    this.setupDequeueCircuitBreaker();
  }

  public async start(): Promise<void> {
    this.logger.info('Starting worker', {
      stageType: this.stageType,
      concurrency: this.options.concurrency ?? 1,
    });

    this.isRunning = true;

    for await (const task of this.taskIterator()) {
      this.logger.debug('Dequeued task for processing', {
        taskId: task.id,
        runningTasks: this.runningTasks.size,
        stageType: this.stageType,
      });

      this.runTask(task);

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

  private runTask(task: Task): void {
    this.logger.info('Running task', { taskId: task.id, stageType: this.stageType });
    const context = {
      signal: this.abortController.signal,
      logger: this.logger,
      producer: new Producer(this.apiClient, this.logger),
      apiClient: this.apiClient,
    };

    const wrapHandler = async (): Promise<void> => {
      try {
        this.logger.debug('Task handler firing', {
          taskId: task.id,
          stageType: this.stageType,
        });

        await this.taskHandlerCircuitBreaker.fire(task, context);

        this.logger.debug('Task handler succeeded', { taskId: task.id, stageType: this.stageType });
        await this.consumer.markTaskCompleted(task.id);
      } catch (error) {
        this.logger.warn('Task handler failed', {
          taskId: task.id,
          stageType: this.stageType,
          error: getErrorMessageFromUnknown(error),
        });
        await this.consumer.markTaskFailed(task.id);
      }
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

  private async *taskIterator(): AsyncGenerator<Task> {
    while (this.isRunning) {
      if (this.taskCircuitBreakerPromise) {
        this.logger.debug('Waiting for task circuit breaker', {
          stageType: this.stageType,
        });

        await Promise.race([this.taskCircuitBreakerPromise, sleep(30000)]);
      }

      const [err, task] = await presult(this.dequeueTaskCircuitBreaker.fire(this.stageType));
      if (err) {
        this.logger.debug('Error while dequeuing task', {
          stageType: this.stageType,
          error: getErrorMessageFromUnknown(err),
        });
      }

      if (task) {
        this.logger.debug('Yielding task from iterator', {
          taskId: task.id,
          stageType: this.stageType,
        });
        yield task;
      }

      await sleep(1000);
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
