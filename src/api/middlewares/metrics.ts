import type { Middleware } from 'openapi-fetch';
import type { JobnikMetrics } from '../../telemetry/metrics';
import { normalizeStatusCode } from '../../telemetry/metrics-utils';

interface RequestTiming {
  startTime: number;
  retryCount: number;
}

/**
 * Creates a middleware that collects HTTP metrics for all requests.
 * Tracks request duration, retry counts, and request sizes.
 *
 * @param metrics - The metrics instance to record to
 * @returns An openapi-fetch middleware
 */
export function createMetricsMiddleware(metrics: JobnikMetrics): Middleware {
  // Use WeakMap to store timing data keyed by request URL
  // This allows us to correlate onRequest and onResponse calls
  const requestTimings = new Map<string, RequestTiming>();

  return {
    async onRequest({ request }) {
      const requestKey = `${request.method}:${request.url}:${Date.now()}`;
      const startTime = performance.now();

      // Check if this is a retry by looking for existing timing with same URL
      const existingTiming = Array.from(requestTimings.entries()).find(([key]) => key.startsWith(`${request.method}:${request.url}:`));

      const retryCount = existingTiming ? existingTiming[1].retryCount + 1 : 0;

      requestTimings.set(requestKey, { startTime, retryCount });

      // Track request size if body exists
      if (request.body) {
        try {
          const clonedRequest = request.clone();
          const bodyText = await clonedRequest.text();
          const sizeBytes = new TextEncoder().encode(bodyText).length;
          const method = request.method.toUpperCase();

          metrics.httpRequestSize.labels(method).observe(sizeBytes);
        } catch {
          // If we can't read the body (e.g., stream already consumed), skip size metric
        }
      }

      // Store the request key in a header so we can retrieve it in onResponse
      // This is a workaround since openapi-fetch doesn't pass context between middleware calls
      request.headers.set('X-Jobnik-Request-Key', requestKey);

      return undefined;
    },

    async onResponse({ response, request }) {
      const requestKey = request.headers.get('X-Jobnik-Request-Key');

      if (requestKey) {
        const timing = requestTimings.get(requestKey);

        if (timing) {
          // Manual timing is kept here due to the Map-based storage pattern
          const duration = (performance.now() - timing.startTime) / 1000;
          const method = request.method.toUpperCase();
          const statusCode = normalizeStatusCode(response.status);
          const wasRetried = timing.retryCount > 0 ? 'true' : 'false';

          // Track request duration
          metrics.httpRequestDuration.labels(method, statusCode.toString(), wasRetried).observe(duration);

          // Track retries if this was a retry
          if (timing.retryCount > 0) {
            // We don't have the exact retry reason from undici here, so we use 'unknown'
            // In the future, we could enhance this by parsing error messages
            metrics.httpRetriesTotal.labels(method, 'unknown').inc(timing.retryCount);
          }

          // Clean up timing data
          requestTimings.delete(requestKey);

          // Remove the internal header
          request.headers.delete('X-Jobnik-Request-Key');
        }
      }

      return undefined;
    },
  };
}
