import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { enqueueJob } from '../services/jobs.js';
import { welcomeText } from '../services/notify.js';
import { findOrCreateUser, getUserByPhone } from '../services/users.js';

export const xmlEscape = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Twilio's request signature: base64(HMAC-SHA1(authToken, url + sorted(key + value)...)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** URL variants Twilio may have signed (with or without the default port). */
function urlVariants(url: string): string[] {
  const variants = new Set([url]);
  try {
    const u = new URL(url);
    if (u.port) variants.add(url.replace(`${u.hostname}:${u.port}`, u.hostname));
    else variants.add(url.replace(u.host, `${u.hostname}:${u.protocol === 'https:' ? 443 : 80}`));
  } catch {
    /* not a URL: only the literal value is tried */
  }
  return [...variants];
}

function spokenAddress(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  const spokenLocal = /^\d+$/.test(local) ? local.split('').join(' ') : local;
  return `${spokenLocal}, at, ${domain.replace(/\./g, ' dot ')}`;
}

export async function twilioRoutes(app: FastifyInstance, ctx: AppContext) {
  const { twilio } = ctx.config;
  if (!twilio.authToken) ctx.log.warn({}, 'TWILIO_AUTH_TOKEN not set: Twilio webhook signatures are NOT verified');

  const params = (req: FastifyRequest): Record<string, string> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) out[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    return out;
  };

  const verify = (req: FastifyRequest) => {
    if (!twilio.validateWebhooks || !twilio.authToken) return;
    const signature = req.headers['x-twilio-signature'];
    if (typeof signature !== 'string') throw new AppError(403, 'invalid_signature', 'Missing Twilio signature.');
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || '';
    const base = twilio.webhookBaseUrl || `${proto}://${host}`;
    const p = params(req);
    const ok = urlVariants(`${base}${req.url}`).some((url) => safeEqual(twilioSignature(twilio.authToken, url, p), signature));
    if (!ok) {
      req.log.warn({ url: `${base}${req.url}` }, 'rejected Twilio webhook with bad signature');
      throw new AppError(403, 'invalid_signature', 'Invalid Twilio signature.');
    }
  };

  const sayAttrs = `${twilio.ivrVoice ? ` voice="${xmlEscape(twilio.ivrVoice)}"` : ''}${twilio.ivrLanguage ? ` language="${xmlEscape(twilio.ivrLanguage)}"` : ''}`;
  const say = (text: string) => `<Say${sayAttrs}>${xmlEscape(text)}</Say>`;
  const twiml = (reply: FastifyReply, inner: string) =>
    reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);

  const menu = (intro = '') =>
    `<Gather input="dtmf" numDigits="1" timeout="10" action="/api/twilio/voice/menu" method="POST">` +
    say(`${intro}Welcome to PhoneMail, where your phone number is your email address. To create your PhoneMail account, press 1. To hear your email address, press 2.`) +
    `</Gather>` +
    say('We did not receive any input. Goodbye!');

  // Incoming call on the toll-free number (or the start of a "call me" call).
  app.post('/api/twilio/voice', { config: { rateLimit: false } }, async (req, reply) => {
    verify(req);
    return twiml(reply, menu());
  });

  app.post('/api/twilio/voice/menu', { config: { rateLimit: false } }, async (req, reply) => {
    verify(req);
    const p = params(req);
    const digit = (p.Digits ?? '').trim();
    // Inbound calls come *from* the user; "call me" calls (Twilio dialing the user, free for them) go *to* the user.
    const caller = (p.Direction ?? '').startsWith('outbound') ? p.To : p.From;
    const phone = normalizePhone(caller ?? '', ctx.config.defaultCountry);

    if (digit !== '1' && digit !== '2') {
      return twiml(reply, say('Sorry, that is not a valid option.') + `<Redirect method="POST">/api/twilio/voice</Redirect>`);
    }
    if (!phone) {
      return twiml(reply, say('Sorry, we could not detect your phone number. Please call from a number that shows caller ID. Goodbye!') + '<Hangup/>');
    }
    if (digit === '2') {
      const existing = await getUserByPhone(ctx.db, phone.e164);
      if (!existing) return twiml(reply, menu('There is no PhoneMail account for this number yet. '));
      return twiml(reply, say(`Your PhoneMail address is ${spokenAddress(existing.address)}. Again, that is ${spokenAddress(existing.address)}. Goodbye!`) + '<Hangup/>');
    }

    const { user, created } = await findOrCreateUser(ctx, phone.e164, 'ivr');
    if (!created) {
      return twiml(reply, say(`You already have a PhoneMail account. Your email address is ${spokenAddress(user.address)}. Goodbye!`) + '<Hangup/>');
    }
    await enqueueJob(ctx.db, 'sms.send', { to: user.phone, body: welcomeText(ctx, user.address), purpose: 'welcome', userId: user.id }, { maxAttempts: 3 });
    return twiml(
      reply,
      say(
        `Your PhoneMail account has been created. Your email address is ${spokenAddress(user.address)}. ` +
          `You can start receiving emails right away, and we will notify you by SMS. Thank you for choosing PhoneMail. Goodbye!`,
      ) + '<Hangup/>',
    );
  });

  // Incoming SMS: any message creates the account ("HELP" explains how it works).
  app.post('/api/twilio/sms', { config: { rateLimit: false } }, async (req, reply) => {
    verify(req);
    const p = params(req);
    const keyword = (p.Body ?? '').trim().toUpperCase();
    // Twilio handles opt-out keywords itself; never answer them.
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(keyword)) return twiml(reply, '');
    const message = (text: string) => twiml(reply, `<Message>${xmlEscape(text)}</Message>`);
    if (keyword === 'HELP' || keyword === 'INFO') {
      return message('PhoneMail: text JOIN to this number to get a free email address for your phone number. Reply STOP to opt out.');
    }
    const phone = normalizePhone(p.From ?? '', ctx.config.defaultCountry);
    if (!phone) return message('Sorry, we could not read your phone number.');
    const { user, created } = await findOrCreateUser(ctx, phone.e164, 'sms');
    if (!created) return message(`You already have a PhoneMail account: ${user.address}. Sign in at ${ctx.config.publicWebUrl}`);
    return message(welcomeText(ctx, user.address));
  });
}
