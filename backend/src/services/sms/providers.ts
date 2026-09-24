import type { Config } from '../../config.js';
import type { Logger } from '../../context.js';

export interface SmsSendResult {
  id?: string;
}

export interface SmsProvider {
  readonly name: string;
  /** False for template-only channels (Twilio Verify), which ignore the text and send their own template. */
  readonly supportsCustomText: boolean;
  send(toE164: string, body: string): Promise<SmsSendResult>;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

const basicAuth = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const TIMEOUT_MS = 15_000;

/** Development provider: prints the SMS to the API log (and the dev outbox, see sms/index.ts). */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly supportsCustomText = true;
  private counter = 0;
  constructor(private readonly log: Logger) {}
  async send(to: string, body: string): Promise<SmsSendResult> {
    this.log.info({ to, body }, '[console-sms] message');
    return { id: `console-${Date.now()}-${++this.counter}` };
  }
}

/** Twilio Programmable Messaging (free trial: verified destination numbers only). */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  readonly supportsCustomText = true;
  constructor(private readonly cfg: Config['twilio']) {}
  async send(to: string, body: string): Promise<SmsSendResult> {
    const form = new URLSearchParams({ To: to, Body: body });
    if (this.cfg.messagingServiceSid) form.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else form.set('From', this.cfg.fromNumber);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: basicAuth(this.cfg.accountSid, this.cfg.authToken), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await readJson(res);
    if (!res.ok) throw new Error(`Twilio error ${res.status}: ${String(json.message ?? json.raw ?? 'unknown')} (code ${String(json.code ?? '-')})`);
    return { id: typeof json.sid === 'string' ? json.sid : undefined };
  }
}

/**
 * Twilio Verify used as a notification channel. Trial accounts cannot send custom SMS to some
 * countries (e.g. India's DLT rules), but Verify's pre-approved template is always delivered, so we
 * use it as the "you have mail" ping, exactly as the buildathon brief allows.
 */
export class TwilioVerifyTemplateProvider implements SmsProvider {
  readonly name = 'twilio_verify';
  readonly supportsCustomText = false;
  constructor(private readonly cfg: Config['twilio']) {}
  async send(to: string): Promise<SmsSendResult> {
    const result = await twilioStartVerification(this.cfg, to);
    return { id: result.sid };
  }
}

/** SMSGate (https://sms-gate.app): free, open-source app that turns an Android phone into an SMS gateway. */
export class SmsGateProvider implements SmsProvider {
  readonly name = 'smsgate';
  readonly supportsCustomText = true;
  constructor(private readonly cfg: Config['smsgate']) {}
  async send(to: string, body: string): Promise<SmsSendResult> {
    const res = await fetch(`${this.cfg.url}/messages`, {
      method: 'POST',
      headers: { Authorization: basicAuth(this.cfg.username, this.cfg.password), 'Content-Type': 'application/json' },
      body: JSON.stringify({ textMessage: { text: body }, phoneNumbers: [to] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await readJson(res);
    if (!res.ok) throw new Error(`SMSGate error ${res.status}: ${String(json.message ?? json.raw ?? 'unknown')}`);
    return { id: typeof json.id === 'string' ? json.id : undefined };
  }
}

export async function twilioStartVerification(cfg: Config['twilio'], to: string, appHash?: string): Promise<{ sid?: string }> {
  const form = new URLSearchParams({ To: to, Channel: 'sms' });
  if (appHash) form.set('AppHash', appHash);
  const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.verifyServiceSid)}/Verifications`, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg.accountSid, cfg.authToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error(`Twilio Verify error ${res.status}: ${String(json.message ?? json.raw ?? 'unknown')} (code ${String(json.code ?? '-')})`);
  return { sid: typeof json.sid === 'string' ? json.sid : undefined };
}

export async function twilioCheckVerification(cfg: Config['twilio'], to: string, code: string): Promise<boolean> {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.verifyServiceSid)}/VerificationCheck`, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg.accountSid, cfg.authToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, Code: code }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 404 means the verification expired, was already approved, or ran out of attempts.
  if (res.status === 404) return false;
  const json = await readJson(res);
  if (!res.ok) throw new Error(`Twilio Verify error ${res.status}: ${String(json.message ?? json.raw ?? 'unknown')}`);
  return json.status === 'approved';
}

export function createSmsProvider(config: Config, log: Logger): SmsProvider {
  switch (config.sms.provider) {
    case 'twilio':
      return new TwilioSmsProvider(config.twilio);
    case 'twilio_verify':
      return new TwilioVerifyTemplateProvider(config.twilio);
    case 'smsgate':
      return new SmsGateProvider(config.smsgate);
    case 'console':
    default:
      return new ConsoleSmsProvider(log);
  }
}
