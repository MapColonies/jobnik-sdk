import * as api from '@opentelemetry/api';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MockAgent, MockPool } from 'undici';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { createApiClient } from '../src/api/index';

const contextManager = new AsyncHooksContextManager();
contextManager.enable();
api.context.setGlobalContextManager(contextManager);

/* eslint-disable */
// Add type declaration for global mockAgent
declare global {
  var mockAgentForTest: MockAgent;
}

// Mock the Agent constructor from undici to use our MockAgent instance
vi.mock('undici', async () => {
  // Store the actual implementation
  const originalModule = await vi.importActual('undici');

  return {
    ...originalModule,
    // Mock agent constructor to return our mockAgent
    Agent: vi.fn().mockImplementation(() => {
      // We'll set this in the test
      return global.mockAgentForTest;
    }),
  };
});
/* eslint-enable */

describe('apiClient tracing', () => {
  let mockAgent: MockAgent;
  let mockPool: MockPool;
  let apiClient: ReturnType<typeof createApiClient>;
  const memoryExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(memoryExporter);
  const provider = new BasicTracerProvider({ spanProcessors: [spanProcessor] });

  api.trace.setGlobalTracerProvider(provider);

  const tracer = provider.getTracer('my-test-tracer');

  const baseUrl = 'http://localhost:8080';

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    // Store the mockAgent in a global variable so our mocked Agent constructor can access it
    global.mockAgentForTest = mockAgent;
    mockPool = mockAgent.get(baseUrl);

    apiClient = createApiClient(baseUrl, {
      retry: { maxRetries: 0 },
      agentOptions: { keepAliveTimeout: 1 },
    });
  });

  afterEach(async () => {
    await mockAgent.close();
    // Optional property can be deleted
    // @ts-expect-error its a global variable
    delete global.mockAgentForTest;

    memoryExporter.reset();
  });

  it('should create a span for the API call', async () => {
    expect.assertions(1);
    mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(200, []);
    await tracer.startActiveSpan('Test Span', async (span) => {
      await apiClient.GET('/jobs');
      span.end();
    });

    const spans = memoryExporter.getFinishedSpans();

    expect(spans[0]).toHaveProperty('name', 'API Request: GET /jobs');
  });

  it('should set the operation Id as attribute on the span', async () => {
    expect.assertions(1);
    mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(200, []);
    await tracer.startActiveSpan('Test Span', async (span) => {
      await apiClient.GET('/jobs');
      span.end();
    });
    const spans = memoryExporter.getFinishedSpans();

    expect(spans[0]).toHaveProperty(['attributes', 'api.operation_id'], 'findJobs');
  });

  it('should set the span status to ERROR on 4xx response', async () => {
    expect.assertions(1);
    mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(400, 'BadRequest');
    await tracer.startActiveSpan('Test Span', async (span) => {
      try {
        await apiClient.GET('/jobs');
      } catch (err) {
        // Catch the error to prevent it from failing the test
      }
      span.end();
    });

    const spans = memoryExporter.getFinishedSpans();
    expect(spans[0]).toHaveProperty('status', {
      code: api.SpanStatusCode.ERROR,
      message: 'Request failed with error: HTTP 400 error for GET http://localhost:8080/jobs: BadRequest',
    });
  });

  it('should set the span status to ERROR on 5xx response', async () => {
    expect.assertions(1);
    mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(500, 'Internal Server Error');
    await tracer.startActiveSpan('Test Span', async (span) => {
      try {
        await apiClient.GET('/jobs');
      } catch (err) {
        // Catch the error to prevent it from failing the test
      }
      span.end();
    });

    const spans = memoryExporter.getFinishedSpans();
    expect(spans[0]).toHaveProperty('status', {
      code: api.SpanStatusCode.ERROR,
      message: 'Request failed with error: HTTP 500 error for GET http://localhost:8080/jobs: Internal Server Error',
    });
  });
});
