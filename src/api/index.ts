import createClient, { type Client } from 'openapi-fetch';
import type { paths } from '../types';
import { createRetryAgent, HttpClientOptions } from '../network/httpClient';
import { createErrorHandlingMiddleware } from './middlewares/error';
import { createResponseMiddleware } from './middlewares/response';

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export function createApiClient(baseUrl: string, httpClientOptions: HttpClientOptions = {}): Prettify<Client<paths>> {
  const client = createClient<paths>({
    baseUrl,

    headers: {
      'Content-Type': 'application/json',
    },
    dispatcher: createRetryAgent(httpClientOptions),
  });

  client.use({
    onError: createErrorHandlingMiddleware(),
    onResponse: createResponseMiddleware(),
    async onRequest() {
      // Request handling logic can be added here if needed
    },
  });
  return client;
}
