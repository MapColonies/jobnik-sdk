import { API_ERROR_CODES, APIError, APIErrorCode } from './sdkErrors';

export function createAPIErrorFromResponse(response: Response, apiError: { message: string; code: string }): APIError {
  const cause = {
    headers: response.headers,
    url: response.url,
    status: response.status,
    // body: await clonedResponse.text(),
    error: apiError,
  };
  return new APIError(
    apiError.message,
    response.status,
    (API_ERROR_CODES[apiError.code as keyof typeof API_ERROR_CODES] as unknown as APIErrorCode | undefined) ?? API_ERROR_CODES.UNKNOWN_ERROR,
    cause
  );
}
