import type { Config } from '../../config.js';
import type { Logger } from '../../context.js';
import type { Db } from '../../db/pool.js';
import { createSmsProvider, type SmsProvider } from './providers.js';

export type SmsPurpose = 'otp' | 'notification' | 'welcome';

export interface SmsSendInput {
  to: string;
  body: string;
  purpose: SmsPurpose;
  userId?: string | null;
  /** Secret substring (an OTP) that must not be persisted when a real provider is used. */
  secret?: string;
}

export interface SmsService {
  readonly provider: SmsProvider;
  /** Returns 'skipped' when the provider cannot deliver this kind of message. Throws on provider errors. */
  send(input: SmsSendInput): Promise<'sent' | 'skipped'>;
}

export function createSmsService(config: Config, db: Db, log: Logger, provider: SmsProvider = createSmsProvider(config, log)): SmsService {
  const record = async (input: SmsSendInput, status: 'sent' | 'failed' | 'skipped', providerId?: string, error?: string) => {
    let body = input.body;
    // Codes are only kept in the log for the console provider, where the log *is* the delivery channel.
    if (input.secret && provider.name !== 'console') body = body.split(input.secret).join('•'.repeat(input.secret.length));
    if (!provider.supportsCustomText) body = `[${provider.name} template] ${body}`;
    await db
      .query(
        `INSERT INTO sms_log (user_id, to_phone, body, purpose, provider, status, provider_message_id, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [input.userId ?? null, input.to, body, input.purpose, provider.name, status, providerId ?? null, error?.slice(0, 1000) ?? null],
      )
      .catch((err: unknown) => log.error({ err }, 'failed to write sms_log'));
  };

  return {
    provider,
    async send(input) {
      if (!provider.supportsCustomText && input.purpose === 'welcome') {
        await record(input, 'skipped', undefined, 'provider only supports template messages');
        return 'skipped';
      }
      try {
        const result = await provider.send(input.to, input.body);
        await record(input, 'sent', result.id);
        log.info({ to: input.to, purpose: input.purpose, provider: provider.name }, 'sms sent');
        return 'sent';
      } catch (err) {
        const message = (err as Error).message;
        await record(input, 'failed', undefined, message);
        log.error({ to: input.to, purpose: input.purpose, provider: provider.name, err: message }, 'sms failed');
        throw err;
      }
    },
  };
}
