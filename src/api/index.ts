import { trace } from '@opentelemetry/api';
import createClient, { type Client } from 'openapi-fetch';
import type { paths } from '../types';
import { createRetryAgent, HttpClientOptions } from '../network/httpClient';
import { tracer } from '../telemetry/trace';
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

  const originalRequest = client.request.bind(client);
  //@ts-expect-error
  client.request = async (method, path, init) => {
    // Custom request handling logic can be added here if needed
    // const b = originalRequest(method, path, init);
    await tracer.startActiveSpan(`API Request: ${method.toUpperCase()} ${path}`, async () => {
      console.log(`Making request: ${method.toUpperCase()} ${path}`, init);
      return originalRequest(method, path, init);
    });
    console.log(`Making request: ${method.toUpperCase()} ${path}`, init);
    //@ts-expect-error
  };

  // void client.request('get', '/jobs', {});

  return client;
}
