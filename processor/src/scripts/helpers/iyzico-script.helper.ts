/**
 * Provides the shared runtime, validation and terminal presentation used by
 * the standalone Iyzico sandbox scripts.
 *
 * The scripts reuse the production Iyzico client and signature service, so
 * their requests exercise the same signing and validation code as the connector.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import { z } from 'zod';

import { AppConfigService } from '../../config/config.service';
import { Env } from '../../config/env.schema';
import { iyzicoErrorCodeSchema } from '../../iyzico/contracts/primitives.schema';
import { IyzicoClient } from '../../iyzico/iyzico.client';
import { IyzicoSignatureService } from '../../iyzico/iyzico-signature.service';

dotenv.config({ quiet: true });

const SANDBOX_ORIGIN = 'https://sandbox-api.iyzipay.com';
const LOG_DIVIDER = '═'.repeat(72);
const LOG_LABEL_WIDTH = 24;

const iyzicoErrorResponseSchema = z.looseObject({
  errorCode: iyzicoErrorCodeSchema.optional(),
  errorMessage: z.string().optional(),
});

/** The environment settings the Iyzico client reads. */
type IyzicoClientSettings = Pick<
  Env,
  'IYZICO_API_KEY' | 'IYZICO_BASE_URL' | 'IYZICO_SECRET_KEY' | 'IYZICO_TIMEOUT'
>;

export const iyzicoScriptEnvironmentSchema = z.object({
  IYZICO_API_KEY: z.string().min(1),
  IYZICO_BASE_URL: z.url().refine((value) => new URL(value).origin === SANDBOX_ORIGIN, {
    message: `must target ${SANDBOX_ORIGIN}`,
  }),
  IYZICO_SECRET_KEY: z.string().min(1),
  IYZICO_TIMEOUT: z.coerce.number().int().positive().default(30000),
});

export interface ScriptContext {
  baseUrl: string;
  client: IyzicoClient;
  get<T>(path: string, parameters: Record<string, number | string>): Promise<T>;
}

/**
 * Builds the Iyzico client from the environment, refusing anything but the
 * sandbox: these scripts move money, a typo in IYZICO_BASE_URL must not reach
 * production.
 */
export function buildScriptContext(): ScriptContext {
  const parsed = iyzicoScriptEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) {
    fail(`The sandbox environment configuration is invalid:\n${describeValidationIssues(parsed.error)}`);
  }

  const { IYZICO_API_KEY, IYZICO_BASE_URL, IYZICO_SECRET_KEY, IYZICO_TIMEOUT } = parsed.data;
  // The script loads only the Iyzico settings, so it cannot build the application
  // configuration service, which validates the whole environment. It hands the client a
  // reader restricted to the keys the client actually consumes.
  const settings: IyzicoClientSettings = {
    IYZICO_API_KEY,
    IYZICO_BASE_URL,
    IYZICO_SECRET_KEY,
    IYZICO_TIMEOUT,
  };
  const config = {
    get: <K extends keyof IyzicoClientSettings>(key: K): IyzicoClientSettings[K] => settings[key],
  } as unknown as AppConfigService;

  const signatureService = new IyzicoSignatureService();

  return {
    baseUrl: IYZICO_BASE_URL,
    client: new IyzicoClient(config, signatureService),
    async get<T>(path: string, parameters: Record<string, number | string>): Promise<T> {
      const headers = signatureService.buildAuthHeader(IYZICO_API_KEY, IYZICO_SECRET_KEY, path, '{}');
      const response = await axios.get<T>(`${IYZICO_BASE_URL}${path}`, {
        data: {},
        headers: { ...headers, 'Content-Type': 'application/json' },
        params: parameters,
        timeout: IYZICO_TIMEOUT,
      });
      return response.data;
    },
  };
}

/**
 * Turns whatever a failed call threw into something actionable: an Axios error
 * hides the Iyzico body behind a generic "Request failed with status code N".
 */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 'no response';
    const parsed = iyzicoErrorResponseSchema.safeParse(error.response?.data);
    if (parsed.success) {
      const code = parsed.data.errorCode === undefined ? '-' : String(parsed.data.errorCode);
      return `HTTP ${status} — [${code}] ${parsed.data.errorMessage ?? error.message}`;
    }
    return `HTTP ${status} — ${error.code ?? error.message}`;
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function describeValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `   ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

export function fail(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

export function isMatchingSandboxPaymentPageUrl(value: string, token: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.hostname.startsWith('sandbox-') &&
    url.hostname.endsWith('.iyzipay.com') &&
    url.searchParams.get('token') === token
  );
}

export function logCelebration(message: string): void {
  console.info(`\n🎉 ${message}`);
}

export function logDetail(label: string, ...values: unknown[]): void {
  console.info(`   ${label.padEnd(LOG_LABEL_WIDTH)}:`, ...values);
}

export function logHeader(title: string, description: string): void {
  console.info(`\n${LOG_DIVIDER}`);
  console.info(`🧪 ${title}`);
  console.info(`   ${description}`);
  console.info(LOG_DIVIDER);
}

export function logStep(message: string): void {
  console.info(`\n▶️  ${message}`);
}

export function logSuccess(message: string): void {
  console.info(`✅ ${message}`);
}
