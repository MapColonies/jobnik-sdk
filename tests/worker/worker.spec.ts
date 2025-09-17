import { setTimeout as sleep } from 'timers/promises';
import { describe, it, expect, afterEach, vi, beforeAll, afterAll, beforeEach, type MockedFunction } from 'vitest';
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { MockAgent, type MockPool } from 'undici';
import createClient from 'openapi-fetch';
import { createApiClient } from '../../src/api/index';
import { Worker, type TaskHandler, type WorkerOptions } from '../../src/clients/worker';
import { NoopLogger } from '../../src/telemetry/noopLogger';
import type { StageId, TaskId } from '../../src/types/brands';
import type { Task, TaskData } from '../../src/types/task';
import type { Logger } from '../../src/types';

propagation.setGlobalPropagator(new W3CTraceContextPropagator());

function createMockTask(override: Partial<Task> = {}): Task {
  const defaultTask: Task = {
    id: 'task-123' as TaskId,
    stageId: 'stage-456' as StageId,
    userMetadata: { batchId: 'batch-1' },
    data: { sourceUrl: 'https://example.com/image.jpg', targetUrl: 'https://example.com/resized.jpg' },
    status: 'IN_PROGRESS',
    attempts: 1,
    maxAttempts: 5,
    creationTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    tracestate: 'vendor=test',
  };

  return {
    ...defaultTask,
    ...override,
    userMetadata: override.userMetadata ?? defaultTask.userMetadata,
  };
}

function collectEvents(worker: Worker) {
  const events: { type: string; data: unknown }[] = [];

  worker.on('started', (data) => events.push({ type: 'started', data }));
  worker.on('stopped', (data) => events.push({ type: 'stopped', data }));
  worker.on('taskStarted', (data) => events.push({ type: 'taskStarted', data }));
  worker.on('taskCompleted', (data) => events.push({ type: 'taskCompleted', data }));
  worker.on('taskFailed', (data) => events.push({ type: 'taskFailed', data }));
  worker.on('error', (data) => events.push({ type: 'error', data }));
  worker.on('circuitBreakerOpened', (data) => events.push({ type: 'circuitBreakerOpened', data }));
  worker.on('circuitBreakerClosed', (data) => events.push({ type: 'circuitBreakerClosed', data }));

  return events;
}

describe('Worker', () => {
  let mockAgent: MockAgent;
  let mockPool: MockPool;
  let apiClient: ReturnType<typeof createApiClient>;
  let worker: Worker;
  let logger: Logger;
  let taskHandler: MockedFunction<TaskHandler<TaskData>>;

  const baseUrl = 'http://localhost:8080';
  const stageType = 'image-resize';

  beforeAll(() => {
    // logger = {
    //   debug: console.log,
    //   info: console.log,
    //   warn: console.warn,
    //   error: console.error,
    // };
    logger = new NoopLogger();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    taskHandler = vi.fn().mockResolvedValue(undefined);

    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    // global.mockAgentForTest = mockAgent;

    mockPool = mockAgent.get(baseUrl);
    // apiClient = createApiClient(baseUrl, {
    //   retry: { maxRetries: 0 },
    //   agentOptions: { keepAliveTimeout: 1 },
    // });
    apiClient = createClient({ dispatcher: mockAgent, baseUrl });
    const workerOptions: WorkerOptions = {
      concurrency: 1,
      taskHandlerCircuitBreaker: { enabled: true },
      pullingInterval: 500,
    };

    worker = new Worker(taskHandler, stageType, workerOptions, logger, apiClient);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();

    try {
      await worker.stop();
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    await mockAgent.close();
    // @ts-expect-error global cleanup
    delete global.mockAgentForTest;
  });

  describe('Task Processing', () => {
    describe('Happy Path', () => {
      it('should successfully process a single task', async () => {
        const mockTask = createMockTask({ id: 'task-1' as TaskId });

        const events = collectEvents(worker);

        // Mock successful API calls - simplified without chaining
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(200, JSON.stringify({ success: true }));

        void worker.start();
        vi.runAllTicks();
        await vi.advanceTimersByTimeAsync(200000);
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledTimes(1);
        expect(taskHandler).toHaveBeenCalledWith(mockTask, expect.objectContaining({}));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(events).not.toSatisfyAny((event) => event.type === 'error');
      });

      it('should process multiple tasks sequentially', async () => {
        const tasks = [createMockTask({ id: 'task-1' as TaskId }), createMockTask({ id: 'task-2' as TaskId })];
        let taskIndex = 0;

        mockPool
          .intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' })
          .reply(200, () => {
            const task = tasks[taskIndex];
            taskIndex++;
            return JSON.stringify(task ?? null);
          })
          .times(3); // Two tasks + one null to stop
        // Return 404 for "no more tasks" case
        mockPool
          .intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' })
          .reply(404, JSON.stringify(null))
          .persist();
        mockPool
          .intercept({ path: /\/tasks\/.+\/completed/, method: 'PUT' })
          .reply(200, JSON.stringify({ success: true }))
          .times(2);

        const events = collectEvents(worker);

        void worker.start();
        // Process first task
        await vi.advanceTimersByTimeAsync(15000);
        vi.runAllTicks();
        // Process second task
        await vi.advanceTimersByTimeAsync(15000);
        vi.runAllTicks();
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledTimes(2);
        const taskStartedEvents = events.filter((e) => e.type === 'taskStarted');
        expect(taskStartedEvents).toHaveLength(2);
      });

      it('should ');
    });

    describe('Sad Path - Task Handler Failures', () => {
      it('should handle task handler errors and mark task as failed', async () => {
        const mockTask = createMockTask({ id: 'task-fail' as TaskId });
        const taskError = new Error('Task processing failed');

        taskHandler.mockRejectedValue(taskError);

        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(200, JSON.stringify({ success: true }));

        const events = collectEvents(worker);

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledTimes(1);

        const taskFailedEvent = events.find((e) => e.type === 'taskFailed');
        expect(taskFailedEvent?.data).toEqual({
          taskId: mockTask.id,
          stageType,
          error: taskError,
        });
      });

      it('should handle repeated task failures', async () => {
        const mockTask = createMockTask({ id: 'task-fail' as TaskId });
        const taskError = new Error('Task processing failed');

        taskHandler.mockRejectedValue(taskError);

        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(null));

        mockPool
          .intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' })
          .reply(200, JSON.stringify({ success: true }))
          .persist();

        const events = collectEvents(worker);

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledTimes(2);

        const taskFailedEvent = events.find((e) => e.type === 'taskFailed');
        expect(taskFailedEvent?.data).toEqual({
          taskId: mockTask.id,
          stageType,
          error: taskError,
        });
      });
    });

    describe('Bad Path - API Failures', () => {
      it('should handle dequeue API failures', async () => {
        mockPool
          .intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' })
          .reply(500, JSON.stringify({ error: 'Internal Server Error' }));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));

        const events = collectEvents(worker);

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        const errorEvents = events.filter((e) => e.type === 'error');
        expect(errorEvents).toHaveLength(1);
      });

      it('should handle two task marking API failures', async () => {
        const mockTask = createMockTask({ id: 'task-1' as TaskId });

        const events = collectEvents(worker);

        // Mock successful API calls - simplified without chaining
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(500, JSON.stringify({ error: true }));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(500, JSON.stringify({ error: true }));

        vi.spyOn(logger, 'error').mockImplementationOnce(() => {
          throw new Error('Simulated logging failure');
        });

        void worker.start();
        vi.runAllTicks();
        await vi.advanceTimersByTimeAsync(200000);
        await worker.stop();

        const errorEvents = events.filter((e) => e.type === 'error');
        expect(errorEvents).toHaveLength(2);
      });
    });
  });

  describe('Worker Lifecycle', () => {
    describe('Happy Path', () => {
      it('should start and stop cleanly with no tasks', async () => {
        mockPool
          .intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' })
          .reply(404, JSON.stringify(null))
          .persist();

        const events = collectEvents(worker);

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toEqual(['started', 'stopped']);

        const startedEvent = events.find((e) => e.type === 'started');
        expect(startedEvent?.data).toEqual({
          stageType,
          concurrency: 1,
        });
      });
    });

    describe('Sad Path', () => {
      it('should handle stop during task processing', async () => {
        const mockTask = createMockTask({ id: 'task-abort' as TaskId });
        let signalAborted = false;

        taskHandler.mockImplementation(async (task, context) => {
          const checkAbort = async () => {
            if (context.signal.aborted) {
              signalAborted = true;
            } else {
              await sleep(100);
            }
          };
          while (!signalAborted) {
            await checkAbort();
          }
        });

        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(200, JSON.stringify({ success: true }));

        void worker.start();

        // Start task processing
        await vi.advanceTimersByTimeAsync(1000);
        vi.runAllTicks();

        // Stop worker while task is running
        const stopPromise = worker.stop();
        await vi.advanceTimersByTimeAsync(1000);
        vi.runAllTicks();
        await stopPromise;

        expect(signalAborted).toBe(true);
      });
    });
  });

  describe('Configuration', () => {
    describe('Happy Path', () => {
      it('should accept custom circuit breaker configuration', async () => {
        const customWorker = new Worker(
          taskHandler,
          stageType,
          {
            taskHandlerCircuitBreaker: {
              enabled: false,
            },
            dequeueTaskCircuitBreaker: {
              errorThresholdPercentage: 25,
              resetTimeout: 60000,
            },
          },
          logger,
          apiClient
        );

        expect(customWorker).toBeDefined();
        await customWorker.stop();
      });
    });
  });

  describe('Observability', () => {
    describe('Happy Path', () => {
      it('should preserve trace context from tasks', async () => {
        const mockTask = createMockTask({
          id: 'task-trace' as TaskId,
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=test,key=value',
        });

        taskHandler.mockImplementation(async (task) => {
          expect(task.traceparent).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
          expect(task.tracestate).toBe('vendor=test,key=value');
          return Promise.resolve();
        });

        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(200, JSON.stringify({ success: true }));

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            tracestate: 'vendor=test,key=value',
          }),
          expect.objectContaining({})
        );
      });

      it('should provide task handler with proper context', async () => {
        const mockTask = createMockTask({ id: 'task-context' as TaskId });

        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(200, JSON.stringify(mockTask));
        mockPool.intercept({ path: `/stages/${stageType}/tasks/dequeue`, method: 'PATCH' }).reply(404, JSON.stringify(null));
        mockPool.intercept({ path: `/tasks/${mockTask.id}/status`, method: 'PUT' }).reply(200, JSON.stringify({ success: true }));

        void worker.start();
        await vi.advanceTimersByTimeAsync(10000);
        vi.runAllTicks();
        await worker.stop();

        expect(taskHandler).toHaveBeenCalledWith(mockTask, expect.objectContaining({}));

        const context = taskHandler.mock.calls[0]?.[1];
        expect(context?.signal.aborted).toBe(true);
        expect(context?.logger).toBeDefined();
        expect(context?.producer).toBeDefined();
        expect(context?.apiClient).toBeDefined();
      });
    });
  });
});
