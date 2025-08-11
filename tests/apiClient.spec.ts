/**
 * @fileoverview Tests for API client with focus on error handling middleware using undici MockAgent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, MockPool } from 'undici';
import { createApiClient } from '../src/api/index';
import { NetworkError, APIError } from '../src/errors/sdkErrors';
import { JobId, StageId } from '../src/types/brands';

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

describe('API Client Error Handling Middleware', () => {
  let mockAgent: MockAgent;
  let mockPool: MockPool;
  let apiClient: ReturnType<typeof createApiClient>;

  const baseUrl = 'http://localhost:8080';

  // Test matrix for retry configurations
  const retryConfigs = [
    { name: 'without retry', maxRetries: 0 },
    { name: 'with retry', maxRetries: 1 },
  ] as const;

  describe.each(retryConfigs)('$name (maxRetries: $maxRetries)', ({ maxRetries }) => {
    beforeEach(() => {
      mockAgent = new MockAgent();
      mockAgent.disableNetConnect();
      // Store the mockAgent in a global variable so our mocked Agent constructor can access it
      global.mockAgentForTest = mockAgent;
      mockPool = mockAgent.get(baseUrl);

      apiClient = createApiClient(baseUrl, {
        retry: { maxRetries },
        agentOptions: { keepAliveTimeout: 1 },
      });
    });

    afterEach(async () => {
      await mockAgent.close();
      // Optional property can be deleted
      // @ts-expect-error its a global variable
      delete global.mockAgentForTest;
    });

    // describe('HTTP Response Error Handling', () => {
    //   describe('400 Bad Request', () => {
    //     it('should throw BadRequestError for 400 with simple error message', async () => {
    //       const errorResponse = { message: 'Invalid job parameters' };
    //       mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(400, JSON.stringify(errorResponse), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs');

    //       await expect(reqPromise).rejects.toThrow(BadRequestError);
    //       await expect(reqPromise).rejects.toThrow('HTTP 400 error for GET http://localhost:8080/jobs: Invalid job parameters');
    //     });

    //     it('should throw BadRequestError for 400 with non-JSON response', async () => {
    //       mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(400, 'Bad Request', {
    //         headers: { 'content-type': 'text/plain' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs');

    //       await expect(reqPromise).rejects.toThrow(BadRequestError);
    //       await expect(reqPromise).rejects.toThrow('HTTP 400 error for GET http://localhost:8080/jobs: Bad Request');
    //     });

    //     it('should throw BadRequestError for 400 with malformed JSON', async () => {
    //       mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(400, '{ invalid json }', {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs');

    //       await expect(reqPromise).rejects.toThrow(BadRequestError);
    //       await expect(reqPromise).rejects.toThrow('HTTP 400 error for GET http://localhost:8080/jobs: { invalid json }');
    //     });
    //   });

    //   describe('404 Not Found', () => {
    //     it('should throw NotFoundError for job resource', async () => {
    //       const jobId = '123e4567-e89b-12d3-a456-426614174000' as JobId;
    //       const errorResponse = { message: 'Job not found' };

    //       mockPool.intercept({ path: `/jobs/${jobId}`, method: 'GET' }).reply(404, JSON.stringify(errorResponse), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs/{jobId}', { params: { path: { jobId } } });

    //       await expect(reqPromise).rejects.toThrow(NotFoundError);
    //       await expect(reqPromise).rejects.toThrow(`Resource Job with ID ${jobId} not found.`);
    //     });

    //     it('should throw NotFoundError for stage resource', async () => {
    //       const stageId = '456e7890-e89b-12d3-a456-426614174001' as StageId;

    //       mockPool.intercept({ path: `/stages/${stageId}`, method: 'GET' }).reply(404, JSON.stringify({ message: 'Stage not found' }), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/stages/{stageId}', { params: { path: { stageId } } });

    //       await expect(reqPromise).rejects.toThrow(NotFoundError);
    //       await expect(reqPromise).rejects.toThrow(`Resource Stage with ID ${stageId} not found.`);
    //     });

    //     it('should throw NotFoundError for task resource', async () => {
    //       const taskId = '789e0123-e89b-12d3-a456-426614174002';

    //       mockPool.intercept({ path: `/tasks/${taskId}`, method: 'GET' }).reply(404, JSON.stringify({ message: 'Task not found' }), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/tasks/{taskId}', { params: { path: { taskId } } });

    //       await expect(reqPromise).rejects.toThrow(NotFoundError);
    //       await expect(reqPromise).rejects.toThrow(`Resource Task with ID ${taskId} not found.`);
    //     });
    //   });

    //   describe('500 Internal Server Error', () => {
    //     it('should throw InternalServerError for 500 with error message', async () => {
    //       const errorResponse = { message: 'Database connection failed' };

    //       mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(500, JSON.stringify(errorResponse), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs');

    //       await expect(reqPromise).rejects.toThrow(InternalServerError);
    //       await expect(reqPromise).rejects.toThrow('HTTP 500 error for GET http://localhost:8080/jobs: Database connection failed');
    //     });

    //     it('should throw InternalServerError for 500 with stacktrace', async () => {
    //       const errorResponse = {
    //         message: 'Internal server error',
    //         stacktrace: 'Error: Internal server error\n    at handler (/app/src/controller.js:15:7)',
    //       };

    //       mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(500, JSON.stringify(errorResponse), {
    //         headers: { 'content-type': 'application/json' },
    //       });

    //       const reqPromise = apiClient.GET('/jobs');

    //       await expect(reqPromise).rejects.toThrow(InternalServerError);
    //       await expect(reqPromise).rejects.toThrow('HTTP 500 error for GET http://localhost:8080/jobs: Internal server error');
    //     });
    //   });

    describe('Infrastructure Errors', () => {
      it('should throw BadGatewayError for 502 Bad Gateway', async () => {
        // Set up the mock to respond with the same error for all requests (handles retries)
        mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(502, 'Bad Gateway').persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(APIError);
        await expect(reqPromise).rejects.toThrow('Service temporarily unavailable for GET http://localhost:8080/jobs. Please retry later.');
      });

      it('should throw ServiceUnavailableError for 503 Service Unavailable', async () => {
        mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(503, 'Service Unavailable').persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(APIError);
        await expect(reqPromise).rejects.toThrow('Service temporarily unavailable for GET http://localhost:8080/jobs. Please retry later.');
      });

      it('should throw GatewayTimeoutError for 504 Gateway Timeout', async () => {
        mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(504, 'Gateway Timeout').persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(APIError);
        await expect(reqPromise).rejects.toThrow('Service temporarily unavailable for GET http://localhost:8080/jobs. Please retry later.');
      });

      // describe('Unexpected Status Codes', () => {
      //   it('should throw BadRequestError for 4xx status codes not in OpenAPI spec', async () => {
      //     mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(403, JSON.stringify({ message: 'Forbidden' }), {
      //       headers: { 'content-type': 'application/json' },
      //     });

      //     const reqPromise = apiClient.GET('/jobs');

      //     await expect(reqPromise).rejects.toThrow(BadRequestError);
      //     await expect(reqPromise).rejects.toThrow('HTTP 403 error for GET http://localhost:8080/jobs: Forbidden');
      //   });

      //   it('should throw InternalServerError for 5xx status codes not in OpenAPI spec', async () => {
      //     mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(501, JSON.stringify({ message: 'Not Implemented' }), {
      //       headers: { 'content-type': 'application/json' },
      //     });

      //     const reqPromise = apiClient.GET('/jobs');

      //     await expect(reqPromise).rejects.toThrow(InternalServerError);
      //     await expect(reqPromise).rejects.toThrow('HTTP 501 error for GET http://localhost:8080/jobs: Not Implemented');
      //   });
      // });
    });

    describe('Network Error Handling', () => {
      it('should throw NetworkError for connection refused', async () => {
        const connectionError = new TypeError('fetch failed: ECONNREFUSED');
        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(connectionError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('Failed to connect to http://localhost:8080/jobs: Connection refused');
      });

      it('should throw NetworkError for timeout', async () => {
        const timeoutError = new TypeError('fetch failed: ETIMEDOUT');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(timeoutError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('Request to http://localhost:8080/jobs timed out');
      });

      it('should throw NetworkError for DNS resolution failure', async () => {
        const dnsError = new TypeError('fetch failed: ENOTFOUND');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(dnsError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('DNS resolution failed for http://localhost:8080/jobs');
      });

      it('should throw NetworkError for host unreachable', async () => {
        const hostError = new TypeError('fetch failed: EHOSTUNREACH');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(hostError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('Host unreachable: http://localhost:8080/jobs');
      });

      it('should throw NetworkError for SSL/TLS errors', async () => {
        const sslError = new TypeError('fetch failed: SSL certificate error');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(sslError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('SSL/TLS error when connecting to http://localhost:8080/jobs');
      });

      it('should throw NetworkError for AbortError', async () => {
        const abortError = new DOMException('This operation was aborted', 'AbortError');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(abortError).persist();

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('Request to GET http://localhost:8080/jobs was aborted');
      });

      it('should throw NetworkError for unknown network errors', async () => {
        const unknownError = new TypeError('fetch failed: Unknown network error');

        mockPool.intercept({ path: '/jobs', method: 'GET' }).replyWithError(unknownError);

        const reqPromise = apiClient.GET('/jobs');

        await expect(reqPromise).rejects.toThrow(NetworkError);
        await expect(reqPromise).rejects.toThrow('Network error when requesting GET http://localhost:8080/jobs: fetch failed');
      });
    });

    describe('Successful Responses', () => {
      it('should not trigger error middleware for 200 responses', async () => {
        const successResponse = { jobs: [] };

        mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(200, JSON.stringify(successResponse), {
          headers: { 'content-type': 'application/json' },
        });

        const response = await apiClient.GET('/jobs');

        expect(response.error).toBeUndefined();
        expect(response.data).toEqual(successResponse);
      });

      it('should not trigger error middleware for 204 responses', async () => {
        mockPool.intercept({ path: '/jobs/123', method: 'DELETE' }).reply(204, '');

        const response = await apiClient.DELETE('/jobs/{jobId}', { params: { path: { jobId: '123' as JobId } } });

        expect(response.error).toBeUndefined();
        expect(response.response.status).toBe(204);
      });
    });

    // describe.skip('Error Response Body Parsing', () => {
    // it('should handle empty response bodies gracefully', async () => {
    //   mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(500, '');
    //   const reqPromise = apiClient.GET('/jobs');
    //   await expect(reqPromise).rejects.toThrow(InternalServerError);
    //   await expect(reqPromise).rejects.toThrow('HTTP 500 error for GET http://localhost:8080/jobs');
    // });
    // it('should handle very long error responses by truncating', async () => {
    //   const longErrorText = 'A'.repeat(300); // Longer than MAX_ERROR_TEXT_LENGTH (200)
    //   mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(400, longErrorText, {
    //     headers: { 'content-type': 'text/plain' },
    //   });
    //   const reqPromise = apiClient.GET('/jobs');
    //   await expect(reqPromise).rejects.toThrow(BadRequestError);
    //   await expect(reqPromise).rejects.toThrow('HTTP 400 error for GET http://localhost:8080/jobs');
    // });
    // it('should handle response body reading errors gracefully', async () => {
    //   const errorResponse = { message: 'Server error' };
    //   mockPool.intercept({ path: '/jobs', method: 'GET' }).reply(500, JSON.stringify(errorResponse), {
    //     headers: { 'content-type': 'application/json' },
    //   });
    //   const reqPromise = apiClient.GET('/jobs');
    //   await expect(reqPromise).rejects.toThrow(InternalServerError);
    //   await expect(reqPromise).rejects.toThrow('HTTP 500 error for GET http://localhost:8080/jobs: Server error');
    // });
    // });
  });
});
