import { EventEmitter } from 'node:events';
import { ApiClient } from '../api';
import { Logger } from '../types';
import type { TaskId } from '../types/brands';
import type { StageData } from '../types/stage';
import { Consumer } from './consumer';

export interface WorkerEvents {
  started: { stageType: string; concurrency: number };
  stopped: { stageType: string };
  stopping: { stageType: string; runningTasks: number };
  taskStarted: { taskId: TaskId; stageType: string };
  taskCompleted: { taskId: TaskId; stageType: string; duration: number };
  taskFailed: { taskId: TaskId; stageType: string; error: unknown };
  circuitBreakerOpened: { breaker: 'taskHandler' | 'dequeueTask'; stageType: string };
  circuitBreakerClosed: { breaker: 'taskHandler' | 'dequeueTask'; stageType: string };
  queueEmpty: { stageType: string; consecutiveEmptyPolls: number };
}

export abstract class BaseWorker<StageTypes extends { [K in keyof StageTypes]: StageData } = Record<string, StageData>> extends Consumer<StageTypes> {
  private readonly eventEmitter = new EventEmitter();

  public constructor(apiClient: ApiClient, logger: Logger) {
    super(apiClient, logger);
  }

  public on<K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  public off<K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void): this {
    this.eventEmitter.off(event, listener);
    return this;
  }

  public once<K extends keyof WorkerEvents>(event: K, listener: (data: WorkerEvents[K]) => void): this {
    this.eventEmitter.once(event, listener);
    return this;
  }

  public removeAllListeners<K extends keyof WorkerEvents>(event?: K): this {
    this.eventEmitter.removeAllListeners(event);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async stop(): Promise<void> {
    // Base cleanup - subclasses should call super.stop()
    this.removeAllListeners();
  }

  protected emit<K extends keyof WorkerEvents>(event: K, data: WorkerEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }
}
