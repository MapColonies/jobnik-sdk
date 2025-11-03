import { createMetrics } from '../../src/telemetry/metrics';

/**
 * Creates no-op metrics for testing without requiring prom-client installation
 */
export function createTestMetrics() {
  return createMetrics(undefined); // No registry = no-op metrics
}
