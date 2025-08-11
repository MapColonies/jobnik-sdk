import statusCodes from 'http-status-codes';
import { API_ERRORS_MAP } from '../generated/openapi-errors';
import { JobnikSDKError } from './baseError';

/**
 * Error constants for the Jobnik SDK.
 * These codes provide a more granular way to identify errors beyond class names or HTTP status codes.
 * @public
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const JOBNIK_SDK_ERROR_CODES = {
  ...API_ERRORS_MAP,
  // Network Errors
  NETWORK_CONNECTION_REFUSED: 'NETWORK_CONNECTION_REFUSED',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_REQUEST_CANCELLED: 'NETWORK_REQUEST_CANCELLED',
  NETWORK_REQUEST_ABORTED: 'NETWORK_REQUEST_ABORTED',
  NETWORK_HOST_UNREACHABLE: 'NETWORK_HOST_UNREACHABLE',
  NETWORK_DNS_RESOLUTION_FAILED: 'NETWORK_DNS_RESOLUTION_FAILED',
  NETWORK_SSL_ERROR: 'NETWORK_SSL_ERROR',
  NETWORK_UNKNOWN: 'NETWORK_UNKNOWN',

  // Configuration Errors
  CONFIGURATION_INVALID_URL: 'CONFIGURATION_INVALID_URL',
  CONFIGURATION_MISSING_API_KEY: 'CONFIGURATION_MISSING_API_KEY',
  CONFIGURATION_INVALID_RETRY_POLICY: 'CONFIGURATION_INVALID_RETRY_POLICY',
  CONFIGURATION_MISSING_REQUIRED_FIELD: 'CONFIGURATION_MISSING_REQUIRED_FIELD',

  // Job Processing Errors (General)
  JOB_PROCESSING_FAILED: 'JOB_PROCESSING_FAILED',

  // HTTP Client Errors (mapped from JobProcessingError subtypes)
  HTTP_INTERNAL_SERVER_ERROR: 'HTTP_INTERNAL_SERVER_ERROR',
  HTTP_BAD_GATEWAY: 'HTTP_BAD_GATEWAY',
  HTTP_SERVICE_UNAVAILABLE: 'HTTP_SERVICE_UNAVAILABLE',
  HTTP_GATEWAY_TIMEOUT: 'HTTP_GATEWAY_TIMEOUT',

  // Generic/Unknown SDK Error
  SDK_UNKNOWN_ERROR: 'SDK_UNKNOWN_ERROR',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Type for the Jobnik SDK error codes.
 * @public
 */
export type JobnikSDKErrorCode = (typeof JOBNIK_SDK_ERROR_CODES)[keyof typeof JOBNIK_SDK_ERROR_CODES];

/**
 * Error class for network-related issues, such as connection problems or timeouts.
 * @public
 */
export class NetworkError extends JobnikSDKError {
  /**
   * Creates an instance of NetworkError.
   * @param message - The error message.
   * @param errorCode - A specific network error code from {@link JOBNIK_SDK_ERROR_CODES}.
   * @param cause - Optional original error or server response data.
   */
  public constructor(message: string, errorCode: JobnikSDKErrorCode = JOBNIK_SDK_ERROR_CODES.NETWORK_UNKNOWN, cause?: unknown) {
    super(message, errorCode, cause);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error class for configuration-related problems, like invalid settings or missing credentials.
 * @public
 */
export class ConfigurationError extends JobnikSDKError {
  /**
   * Creates an instance of ConfigurationError.
   * @param message - The error message.
   * @param errorCode - A specific configuration error code from {@link JOBNIK_SDK_ERROR_CODES}.
   * @param cause - Optional original error or server response data.
   */
  public constructor(message: string, errorCode: JobnikSDKErrorCode, cause?: unknown) {
    super(message, errorCode, cause);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base error class for issues encountered while interacting with the API.
 * This class includes an HTTP status code and an optional API-specific error code.
 * @public
 */
export class APIError extends JobnikSDKError {
  /**
   * HTTP status code associated with this error.
   * @public
   * @readonly
   */
  public readonly statusCode: number;

  /**
   * Optional error code from the API response.
   * @public
   * @readonly
   */
  public readonly apiErrorCode?: string;

  /**
   * Creates an instance of JobProcessingError.
   * @param message - The error message.
   * @param statusCode - HTTP status code.
   * @param errorCode - A specific job processing error code from {@link JOBNIK_SDK_ERROR_CODES}.
   * @param cause - Optional original error or server response data.
   */
  public constructor(message: string, statusCode: number, errorCode: JobnikSDKErrorCode, cause?: unknown) {
    super(message, errorCode, cause);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// /**
//  * Error class for when a request is malformed or invalid (e.g., 400 Bad Request).
//  * @public
//  */
// export class BadRequestError extends JobProcessingError {
//   /**
//    * Creates an instance of BadRequestError.
//    * @param message - The error message.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, apiErrorCode?: string, cause?: unknown) {
//     super(message, statusCodes.BAD_REQUEST, JOBNIK_SDK_ERROR_CODES.HTTP_BAD_REQUEST, apiErrorCode, cause);
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

// /**
//  * Error class for when a requested resource is not found (e.g., 404 Not Found).
//  * @public
//  */
// export class NotFoundError extends JobProcessingError {
//   /**
//    * Creates an instance of NotFoundError.
//    * @param resourceType - The type of resource that was not found (e.g., 'Job', 'Stage', 'Task').
//    * @param resourceId - The ID of the resource that was not found.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(resourceType: string, resourceId: string, apiErrorCode?: string, cause?: unknown) {
//     super(
//       `Resource ${resourceType} with ID ${resourceId} not found.`,
//       statusCodes.NOT_FOUND,
//       JOBNIK_SDK_ERROR_CODES.HTTP_NOT_FOUND,
//       apiErrorCode,
//       cause
//     );
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

// /**
//  * Error class for unexpected server-side errors (e.g., 500 Internal Server Error).
//  * @public
//  */
// export class InternalServerError extends JobProcessingError {
//   /**
//    * Creates an instance of InternalServerError.
//    * @param message - The error message.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, apiErrorCode?: string, cause?: unknown) {
//     super(message, statusCodes.INTERNAL_SERVER_ERROR, JOBNIK_SDK_ERROR_CODES.HTTP_INTERNAL_SERVER_ERROR, apiErrorCode, cause);
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

/**
 * Error class for bad gateway errors (e.g., 502 Bad Gateway).
 * @public
 */
// export class BadGatewayError extends APIError {
//   /**
//    * Creates an instance of BadGatewayError.
//    * @param message - The error message.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, cause?: unknown) {
//     super(message, statusCodes.BAD_GATEWAY, JOBNIK_SDK_ERROR_CODES.HTTP_BAD_GATEWAY, cause);
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

// /**
//  * Error class for service unavailable errors (e.g., 503 Service Unavailable).
//  * @public
//  */
// export class ServiceUnavailableError extends APIError {
//   /**
//    * Creates an instance of ServiceUnavailableError.
//    * @param message - The error message.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, cause?: unknown) {
//     super(message, statusCodes.SERVICE_UNAVAILABLE, JOBNIK_SDK_ERROR_CODES.HTTP_SERVICE_UNAVAILABLE, cause);
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

// /**
//  * Error class for gateway timeout errors (e.g., 504 Gateway Timeout).
//  * @public
//  */
// export class GatewayTimeoutError extends APIError {
//   /**
//    * Creates an instance of GatewayTimeoutError.
//    * @param message - The error message.
//    * @param apiErrorCode - Optional error code from the API response.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, cause?: unknown) {
//     super(message, statusCodes.GATEWAY_TIMEOUT, JOBNIK_SDK_ERROR_CODES.HTTP_GATEWAY_TIMEOUT, cause);
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }

// export class ValidationError extends Error {
//   public readonly code = 'VALIDATION_ERROR';
//   /**
//    * Creates an instance of ValidationError.
//    * @param message - The error message.
//    * @param cause - Optional original error or server response data.
//    */
//   public constructor(message: string, cause?: unknown) {
//     super(message, { cause });
//     Object.setPrototypeOf(this, new.target.prototype);
//   }
// }
