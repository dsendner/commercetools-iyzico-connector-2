import axios, { AxiosAdapter, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { IyzicoClient } from '../../src/iyzico/iyzico.client';
import { IyzicoSignatureService } from '../../src/iyzico/iyzico-signature.service';

export const TEST_SECRET = 'sandbox-secret-key';
export const TEST_API_KEY = 'sandbox-api-key';

const fakeConfig = {
  get: (key: string) =>
    (({
      IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
      IYZICO_API_KEY: TEST_API_KEY,
      IYZICO_SECRET_KEY: TEST_SECRET,
      IYZICO_TIMEOUT_MS: 10000,
    }) as Record<string, string | number>)[key],
};

// A queued response: either canned data, or an AxiosError to reject with.
export type QueuedResponse = Record<string, unknown> | AxiosError;

export interface TestClient {
  client: IyzicoClient;
  captured: InternalAxiosRequestConfig[];
}

export function buildTestClient(responses: QueuedResponse[]): TestClient {
  const captured: InternalAxiosRequestConfig[] = [];
  let i = 0;

  const adapter: AxiosAdapter = async (config) => {
    captured.push(config);
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return {
      data: next,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  const instance = axios.create({ adapter });
  jest.spyOn(axios, 'create').mockReturnValue(instance);

  const client = new IyzicoClient(fakeConfig as any, new IyzicoSignatureService());
  return { client, captured };
}

// Helpers to build AxiosErrors for the adapter to throw.
export function httpError(status: number, data: object): AxiosError {
  return new AxiosError(
    'Request failed',
    'ERR_BAD_RESPONSE',
    {} as InternalAxiosRequestConfig,
    null,
    { status, statusText: '', data, headers: {}, config: {} as InternalAxiosRequestConfig },
  );
}

export function transportError(): AxiosError {
  // No `response` → treated as a transport error (retryable)
  return new AxiosError('timeout', 'ECONNABORTED', {} as InternalAxiosRequestConfig);
}