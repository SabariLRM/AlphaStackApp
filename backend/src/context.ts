import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import type { RealtimeHub } from './services/realtime.js';
import type { SmsService } from './services/sms/index.js';
import type { Storage } from './services/storage.js';

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface AppContext {
  config: Config;
  db: Db;
  log: Logger;
  sms: SmsService;
  realtime: RealtimeHub;
  storage: Storage;
}
