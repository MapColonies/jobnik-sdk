import { Options as OpossumOptions } from 'opossum';
import { Logger } from '../telemetry/logger';
import { Producer } from '../clients';
import { ScopedApiClient } from '../api';
import { Task, TaskData } from './task';

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

export type TaskHandler<TaskPayload extends TaskData> = (task: Task<TaskPayload>, context: TaskHandlerContext) => Promise<void>;
