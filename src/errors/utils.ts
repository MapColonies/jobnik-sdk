import { API_ERROR_CODES, APIError, APIErrorCode, JOBNIK_SDK_ERROR_CODES } from './sdkErrors';

export async function createAPIErrorFromResponse(response: Response, apiError: { message: string; code: string }): Promise<APIError> {
  const cause = {
    headers: response.headers,
    url: response.url,
    status: response.status,
    body: await response.text(),
    error: apiError,
  };
  return new APIError(
    apiError.message,
    response.status,
    (API_ERROR_CODES[apiError.code as keyof typeof API_ERROR_CODES] as unknown as APIErrorCode | undefined) ?? API_ERROR_CODES.UNKNOWN_ERROR,
    cause
  );
}
