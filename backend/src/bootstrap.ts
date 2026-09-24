import { mkdir } from 'node:fs/promises';
import pino from 'pino';
import type { Config } from './config.js';
import type { AppContext, Logger } from './context.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { JobWorker } from './services/jobs.js';
import { handleRelayJob } from './services/mail/relay.js';
import { runMaintenance } from './services/maintenance.js';
import { handleNotifyJob, handleSmsSendJob } from './services/notify.js';
import { RealtimeHub } from './services/realtime.js';
import { createSmsService } from './services/sms/index.js';
import type { SmsProvider } from './services/sms/providers.js';
import { createStorage } from './services/storage.js';

export async function createContext(config: Config, opts: { log?: Logger; smsProvider?: SmsProvider } = {}): Promise<AppContext> {
  const log: Logger = opts.log ?? pino({ level: config.logLevel });
  await mkdir(config.dataDir, { recursive: true });
  const db = createPool(config.databaseUrl);
  await migrate(db, (m) => log.info({}, m));
  return {
    config,
    db,
    log,
    sms: createSmsService(config, db, log, opts.smsProvider),
    realtime: new RealtimeHub(),
    storage: createStorage(config.dataDir),
  };
}

export function createWorker(ctx: AppContext): JobWorker {
  return new JobWorker(
    ctx,
    { 'sms.send': handleSmsSendJob, 'sms.notify': handleNotifyJob, 'mail.relay': handleRelayJob },
    runMaintenance,
  );
}
