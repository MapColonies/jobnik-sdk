import type { Middleware } from 'openapi-fetch';
import type { JobnikMetrics } from '../../telemetry/metrics';
import { normalizeStatusCode } from '../../telemetry/metrics-utils';

interface RequestTiming {
  startTime: number;
}

/**
 * Creates a middleware that collects HTTP metrics for all requests.
 * Tracks request duration and request sizes.
 *
 * Note: Retry metrics are tracked in the HTTP client's retry callback, not here.
 *
 * @param metrics - The metrics instance to record to
 * @returns An openapi-fetch middleware
 */
export function createMetricsMiddleware(metrics: JobnikMetrics): Middleware {
  // Use Map to store timing data keyed by request
  // This allows us to correlate onRequest and onResponse calls
  const requestTimings = new Map<string, RequestTiming>();

  return {
    async onRequest({ request }) {
      const requestKey = `${request.method}:${request.url}:${Date.now()}`;
      const startTime = performance.now();

      requestTimings.set(requestKey, { startTime });

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

          // Track request duration
          // Note: We don't track 'retried' here as retries are tracked in the retry callback
          metrics.httpRequestDuration.labels(method, statusCode.toString(), 'false').observe(duration);

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
