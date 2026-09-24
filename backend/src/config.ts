import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected a non-negative integer, got "${v}"` });
        return z.NEVER;
      }
      return n;
    });

const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v.trim()));

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v);

export const SMS_PROVIDERS = ['console', 'twilio', 'twilio_verify', 'smsgate'] as const;
export const OTP_PROVIDERS = ['local', 'twilio_verify'] as const;

const schema = z.object({
  NODE_ENV: str('development'),
  PORT: int(3000),
  HOST: str('0.0.0.0'),
  LOG_LEVEL: str('info'),
  DATABASE_URL: str('postgres://phonemail:phonemail@localhost:5432/phonemail'),
  DATA_DIR: str('./data'),
  MAIL_DOMAIN: str('phonemail.com').transform((v) => v.toLowerCase()),
  DEFAULT_COUNTRY: str('IN').transform((v) => v.toUpperCase()),
  APP_SECRET: str(''),
  INTERNAL_API_TOKEN: str(''),
  COOKIE_SECURE: bool(false),
  PUBLIC_WEB_URL: str('http://localhost:8088'),
  PUBLIC_PORTAL_URL: str('http://localhost:8089'),

  SMS_PROVIDER: z.preprocess(emptyToUndefined, z.enum(SMS_PROVIDERS).default('console')),
  OTP_PROVIDER: z.preprocess(emptyToUndefined, z.enum(OTP_PROVIDERS).default('local')),
  DEV_SMS_OUTBOX: z.string().optional(),
  OTP_LENGTH: int(6),
  OTP_TTL_SECONDS: int(300),
  OTP_RESEND_SECONDS: int(30),
  OTP_MAX_PER_HOUR: int(5),
  OTP_MAX_PER_IP_PER_HOUR: int(30),
  OTP_MAX_ATTEMPTS: int(5),
  SMS_NOTIFY_MAX_PER_HOUR: int(10),
  MOBILE_ACTIVE_DAYS: int(14),

  TWILIO_ACCOUNT_SID: str(),
  TWILIO_AUTH_TOKEN: str(),
  TWILIO_FROM_NUMBER: str(),
  TWILIO_MESSAGING_SERVICE_SID: str(),
  TWILIO_VERIFY_SERVICE_SID: str(),
  TWILIO_WEBHOOK_BASE_URL: str(),
  TWILIO_VALIDATE_WEBHOOKS: bool(true),
  IVR_VOICE: str('Polly.Aditi'),
  IVR_LANGUAGE: str('en-IN'),

  SMSGATE_URL: str('https://api.sms-gate.app/3rdparty/v1'),
  SMSGATE_USERNAME: str(),
  SMSGATE_PASSWORD: str(),
  SMSGATE_SIGNING_KEY: str(),

  SMTP_RELAY_URL: str(''),
  MAX_ATTACHMENT_BYTES: int(25 * 1024 * 1024),
  MAX_AVATAR_BYTES: int(2 * 1024 * 1024),
  TRASH_RETENTION_DAYS: int(30),
  WORKER_ENABLED: bool(true),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  const c = parsed.data;
  const warnings: string[] = [];

  let appSecret = c.APP_SECRET;
  if (appSecret.length < 16) {
    appSecret = randomBytes(32).toString('hex');
    warnings.push('APP_SECRET is not set (or shorter than 16 chars); generated a random one. Pending OTPs and signed links will not survive a restart.');
  }
  let internalToken = c.INTERNAL_API_TOKEN;
  if (!internalToken) {
    internalToken = randomBytes(24).toString('hex');
    warnings.push('INTERNAL_API_TOKEN is not set; generated a random one. The SMTP server will not be able to deliver mail.');
  }

  const needsTwilio = c.SMS_PROVIDER === 'twilio' || c.SMS_PROVIDER === 'twilio_verify' || c.OTP_PROVIDER === 'twilio_verify';
  if (needsTwilio && (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN)) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for the configured SMS/OTP provider.');
  }
  if ((c.SMS_PROVIDER === 'twilio_verify' || c.OTP_PROVIDER === 'twilio_verify') && !c.TWILIO_VERIFY_SERVICE_SID) {
    throw new Error('TWILIO_VERIFY_SERVICE_SID is required when using Twilio Verify.');
  }
  if (c.SMS_PROVIDER === 'twilio' && !c.TWILIO_FROM_NUMBER && !c.TWILIO_MESSAGING_SERVICE_SID) {
    throw new Error('TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID is required when SMS_PROVIDER=twilio.');
  }
  if (c.SMS_PROVIDER === 'smsgate' && (!c.SMSGATE_USERNAME || !c.SMSGATE_PASSWORD)) {
    throw new Error('SMSGATE_USERNAME and SMSGATE_PASSWORD are required when SMS_PROVIDER=smsgate.');
  }
  if (c.OTP_PROVIDER === 'local' && c.SMS_PROVIDER === 'twilio_verify') {
    throw new Error('OTP_PROVIDER=local needs an SMS provider that can send custom text. Use OTP_PROVIDER=twilio_verify together with SMS_PROVIDER=twilio_verify.');
  }
  if (c.OTP_LENGTH < 4 || c.OTP_LENGTH > 8) {
    throw new Error('OTP_LENGTH must be between 4 and 8.');
  }

  // The developer SMS outbox exposes OTP codes, so it is only ever enabled with the console provider.
  const devSmsOutbox = c.SMS_PROVIDER === 'console' && (c.DEV_SMS_OUTBOX === undefined || c.DEV_SMS_OUTBOX === '' ? true : ['1', 'true', 'yes', 'on'].includes(c.DEV_SMS_OUTBOX.toLowerCase()));

  return {
    env: c.NODE_ENV,
    port: c.PORT,
    host: c.HOST,
    logLevel: c.LOG_LEVEL,
    databaseUrl: c.DATABASE_URL,
    dataDir: c.DATA_DIR,
    mailDomain: c.MAIL_DOMAIN,
    defaultCountry: c.DEFAULT_COUNTRY,
    appSecret,
    internalToken,
    cookieSecure: c.COOKIE_SECURE,
    publicWebUrl: c.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    publicPortalUrl: c.PUBLIC_PORTAL_URL.replace(/\/+$/, ''),
    sms: {
      provider: c.SMS_PROVIDER,
      notifyMaxPerHour: c.SMS_NOTIFY_MAX_PER_HOUR,
      devOutbox: devSmsOutbox,
    },
    otp: {
      provider: c.OTP_PROVIDER,
      length: c.OTP_LENGTH,
      ttlSeconds: c.OTP_TTL_SECONDS,
      resendSeconds: c.OTP_RESEND_SECONDS,
      maxPerHour: c.OTP_MAX_PER_HOUR,
      maxPerIpPerHour: c.OTP_MAX_PER_IP_PER_HOUR,
      maxAttempts: c.OTP_MAX_ATTEMPTS,
    },
    mobileActiveDays: c.MOBILE_ACTIVE_DAYS,
    twilio: {
      accountSid: c.TWILIO_ACCOUNT_SID,
      authToken: c.TWILIO_AUTH_TOKEN,
      fromNumber: c.TWILIO_FROM_NUMBER,
      messagingServiceSid: c.TWILIO_MESSAGING_SERVICE_SID,
      verifyServiceSid: c.TWILIO_VERIFY_SERVICE_SID,
      webhookBaseUrl: c.TWILIO_WEBHOOK_BASE_URL.replace(/\/+$/, ''),
      validateWebhooks: c.TWILIO_VALIDATE_WEBHOOKS,
      ivrVoice: c.IVR_VOICE,
      ivrLanguage: c.IVR_LANGUAGE,
    },
    smsgate: { url: c.SMSGATE_URL.replace(/\/+$/, ''), username: c.SMSGATE_USERNAME, password: c.SMSGATE_PASSWORD, signingKey: c.SMSGATE_SIGNING_KEY },
    smtpRelayUrl: c.SMTP_RELAY_URL,
    maxAttachmentBytes: c.MAX_ATTACHMENT_BYTES,
    maxAvatarBytes: c.MAX_AVATAR_BYTES,
    trashRetentionDays: c.TRASH_RETENTION_DAYS,
    workerEnabled: c.WORKER_ENABLED,
    warnings,
  };
}
