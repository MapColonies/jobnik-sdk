import { Agent, Dispatcher, RetryAgent } from 'undici';
import { StatusCodes } from 'http-status-codes';
import type { Logger } from '../telemetry/logger';
import { NoopLogger } from '../telemetry/noopLogger';

/**
 * Options for configuring the retry behavior in HTTP requests.
 */
interface RetryOptions {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  maxRetries?: number;

  /**
   * HTTP status codes that should trigger a retry.
   * @default [500, 502, 503, 504]
   */
  statusCodes?: number[];

  /**
   * Error codes that should trigger a retry.
   * @default ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']
   */
  errorCodes?: string[];

  /**
   * Initial base retry delay in milliseconds.
   * @default 100
   */
  initialBaseRetryDelayMs?: number;

  /**
   * If true, disables jitter and uses only the base delay for retries.
   * If false or undefined, jitter is enabled and the delay is randomized.
   * @default false
   * @remarks When true, the retry delay will not be randomized.
   */
  disableJitter?: boolean;

  /**
   * Maximum jitter factor for retry delay. Should be a number between 0 and 1 (inclusive).
   * The actual jitter factor is calculated as JITTER_MIN_FACTOR + Math.random() * maxJitterFactor.
   * A value of 0 means the jitter factor will always be JITTER_MIN_FACTOR (no additional randomization).
   * @default 1
   * @remarks Used to randomize the retry delay to avoid thundering herd problems.
   */
  maxJitterFactor?: number;
}

/**
 * Options for configuring the HTTP client behavior.
 */
interface HttpClientOptions {
  /**
   * Options for configuring retry behavior.
   */
  retry?: RetryOptions;

  /**
   * Options for the underlying agent.
   */
  agentOptions?: Agent.Options;

  /**
   * Logger instance for client operations.
   * @default new NoopLogger()
   */
  logger?: Logger;
}

/**
 * HTTP status codes that should trigger a retry by default.
 */
const DEFAULT_RETRY_STATUS_CODES = [
  StatusCodes.INTERNAL_SERVER_ERROR,
  StatusCodes.BAD_GATEWAY,
  StatusCodes.SERVICE_UNAVAILABLE,
  StatusCodes.GATEWAY_TIMEOUT,
];

/**
 * Error codes that should trigger a retry by default.
 */
const DEFAULT_RETRY_ERROR_CODES = [
  'ECONNRESET', // Connection reset by peer
  'ECONNREFUSED', // Connection refused
  'ETIMEDOUT', // Connection timeout
  'ENOTFOUND', // DNS lookup failed
  'EAI_AGAIN', // Temporary failure in name resolution
];

/**
 * Maximum retry count by default.
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Initial delay for retry in milliseconds.
 */
const INITIAL_BASE_RETRY_DELAY_MS = 100;

/**
 * Maximum delay for retry in milliseconds (30 seconds).
 */
const MAX_RETRY_DELAY_MS = 30000;

/**
 * Exponential backoff factor.
 */
const RETRY_BACKOFF_FACTOR = 2;

/**
 * Maximum safe retry count to prevent excessive exponential calculations.
 */
const MAX_SAFE_RETRY_COUNT = 15;

/**
 * Minimum jitter factor for retry delay (0.5x base delay).
 * @internal
 */
const JITTER_MIN_FACTOR = 0.5;

/**
 * Creates a RetryAgent with proper configuration for network resilience.
 */
export function createRetryAgent(options: HttpClientOptions = {}): Dispatcher {
  const logger = options.logger ?? new NoopLogger();
  const agentOptions = options.agentOptions ?? {};
  const retryOptions = options.retry ?? {};
  const initialBaseRetryDelayMs = retryOptions.initialBaseRetryDelayMs ?? INITIAL_BASE_RETRY_DELAY_MS;
  const maxJitterFactor = retryOptions.maxJitterFactor ?? 1; // Default to 1 if not provided
  const disableJitter = retryOptions.disableJitter ?? false;

  // Create the base agent
  const baseAgent = new Agent(agentOptions);

  // Create the RetryAgent with proper configuration
  // We need to cast to unknown and then any here to fix the type mismatch
  // between our options and what RetryAgent expects
  const retryAgent = new RetryAgent(baseAgent, {
    maxRetries: retryOptions.maxRetries ?? DEFAULT_MAX_RETRIES,
    statusCodes: retryOptions.statusCodes ?? DEFAULT_RETRY_STATUS_CODES,
    errorCodes: retryOptions.errorCodes ?? DEFAULT_RETRY_ERROR_CODES,
    retry: (err: Error, context, cb: (err?: Error | null) => void): void => {
      // Extract attempt number from context.state.counter (undici RetryHandler pattern)
      const attempt = typeof context.state.counter === 'number' ? context.state.counter : 0;
      const maxRetries = retryOptions.maxRetries ?? DEFAULT_MAX_RETRIES;
      const isMaxed = attempt > maxRetries;

      if (isMaxed) {
        logger.warn(`[RetryAgent] Max retries reached (${attempt}/${maxRetries}) for request. Aborting.`);
        cb(err);
        return;
      }
      // Calculate exponential backoff delay with jitter
      const baseDelay = Math.min(
        initialBaseRetryDelayMs * Math.pow(RETRY_BACKOFF_FACTOR, Math.min(attempt, MAX_SAFE_RETRY_COUNT)),
        MAX_RETRY_DELAY_MS
      );
      // If jitter is disabled, use only the base delay
      const jitterFactor = disableJitter ? 1 : JITTER_MIN_FACTOR + Math.random() * maxJitterFactor;
      const delay = Math.floor(baseDelay * jitterFactor);
      logger.info(`[RetryAgent] Retry #${attempt + 1} in ${delay}ms due to error: ${err.message}`);
      setTimeout(() => cb(null), delay);
    },
  });

  // Log retry agent configuration
  const loggableOptions = {
    maxRetries: retryOptions.maxRetries ?? DEFAULT_MAX_RETRIES,
    statusCodes: retryOptions.statusCodes ?? [...DEFAULT_RETRY_STATUS_CODES],
    errorCodes: retryOptions.errorCodes ?? [...DEFAULT_RETRY_ERROR_CODES],
    agentOptions: Object.keys(agentOptions).length > 0 ? '[Agent Options Present]' : undefined,
  };

  logger.info(`[RetryAgent] Initialized with options: ${JSON.stringify(loggableOptions)}`);

  return retryAgent;
}

export type { HttpClientOptions, RetryOptions };
