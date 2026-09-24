import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createContext, createWorker } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import type { SmsProvider } from '../src/services/sms/providers.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://test:test@localhost:55432/phonemail_test';
export const INTERNAL_TOKEN = 'test-internal-token';

export class FakeSms implements SmsProvider {
  readonly name = 'console';
  readonly supportsCustomText = true;
  sent: { to: string; body: string }[] = [];
  fail = false;
  async send(to: string, body: string) {
    if (this.fail) throw new Error('provider down');
    this.sent.push({ to, body });
    return { id: `fake-${this.sent.length}` };
  }
  lastCodeFor(phone: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === phone && /code is/.test(m.body));
    const code = msg?.body.match(/code is (\d+)/)?.[1];
    if (!code) throw new Error(`no OTP sent to ${phone}`);
    return code;
  }
}

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  sms: FakeSms;
  close(): Promise<void>;
  runJobs(): Promise<void>;
}

async function resetDatabase() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  await resetDatabase();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'phonemail-test-'));
  const config = loadConfig({
    DATABASE_URL: TEST_DB,
    DATA_DIR: dataDir,
    APP_SECRET: 'test-secret-test-secret-123456',
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    OTP_RESEND_SECONDS: '0',
    OTP_MAX_PER_HOUR: '50',
    LOG_LEVEL: 'silent',
    ...env,
  });
  const sms = new FakeSms();
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const ctx = await createContext(config, { log: silent, smsProvider: sms });
  const app = await buildApp(ctx, { logger: false });
  await app.ready();
  const worker = createWorker(ctx);
  return {
    app,
    ctx,
    sms,
    async runJobs() {
      while (await worker.runOnce()) {
        /* drain */
      }
    },
    async close() {
      await app.close();
      await ctx.db.end();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Signs a user in through the real OTP flow and returns a Bearer token. */
export async function login(h: Harness, phone: string, client: 'mobile' | 'web' = 'mobile') {
  const req = await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone } });
  if (req.statusCode !== 200) throw new Error(`otp request failed: ${req.body}`);
  const e164 = req.json().phone as string;
  const code = h.sms.lastCodeFor(e164);
  const res = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone, code, client } });
  if (res.statusCode !== 200) throw new Error(`otp verify failed: ${res.body}`);
  const body = res.json();
  const cookie = res.cookies.find((c) => c.name === 'pm_session')?.value;
  return { token: body.token as string | undefined, cookie, user: body.user, isNewUser: body.isNewUser as boolean };
}

export function api(h: Harness, token: string) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const res = await h.app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.body ? (res.json() as any) : undefined };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload ?? {}),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload ?? {}),
    put: (url: string, payload?: unknown) => call('PUT', url, payload ?? {}),
    del: (url: string, payload?: unknown) => call('DELETE', url, payload),
  };
}
