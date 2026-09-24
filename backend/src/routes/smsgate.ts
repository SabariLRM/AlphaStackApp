import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { enqueueJob } from '../services/jobs.js';
import { welcomeText } from '../services/notify.js';
import { findOrCreateUser } from '../services/users.js';

/** Only texts that ask for an account create one: the gateway is usually someone's everyday phone. */
const JOIN_RE = /^\s*(join|start|register|signup|sign\s+up|phonemail)\b/i;
const HELP_RE = /^\s*(help|info)\b/i;
const MAX_CLOCK_SKEW_SECONDS = 300;

const webhookSchema = z
  .object({
    event: z.string(),
    payload: z
      .object({
        message: z.string().optional().default(''),
        sender: z.string().optional(),
        // Older SMSGate versions call the sender "phoneNumber".
        phoneNumber: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** SMSGate signs HMAC-SHA256(signingKey, rawBody + X-Timestamp) as hex in X-Signature. */
export function smsgateSignature(signingKey: string, rawBody: string, timestamp: string): string {
  return createHmac('sha256', signingKey).update(rawBody + timestamp).digest('hex');
}

/**
 * Free SMS sign-up: the SMSGate app (https://sms-gate.app) on an ordinary Android phone forwards
 * incoming texts here. Texting JOIN to that phone's local number creates the sender's account,
 * so nobody pays for an international SMS to a Twilio number.
 */
export async function smsgateRoutes(app: FastifyInstance, ctx: AppContext) {
  const { signingKey } = ctx.config.smsgate;

  await app.register(async (scope) => {
    // Keep the exact bytes: the signature covers the raw body.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new AppError(400, 'invalid_json', 'Body is not valid JSON.'), undefined);
      }
    });

    scope.post('/api/smsgate/webhook', { config: { rateLimit: false } }, async (req) => {
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
      if (signingKey) {
        const signature = req.headers['x-signature'];
        const timestamp = req.headers['x-timestamp'];
        if (typeof signature !== 'string' || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) {
          throw new AppError(403, 'invalid_signature', 'Missing SMSGate signature.');
        }
        if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
          throw new AppError(403, 'invalid_signature', 'Stale SMSGate webhook.');
        }
        if (!safeEqual(signature.toLowerCase(), smsgateSignature(signingKey, raw, timestamp))) {
          throw new AppError(403, 'invalid_signature', 'Invalid SMSGate signature.');
        }
      } else if (!ctx.config.sms.devOutbox) {
        // Unsigned webhooks could create accounts for any number, so they are only accepted in local dev mode.
        throw new AppError(403, 'not_configured', 'Set SMSGATE_SIGNING_KEY to accept SMSGate webhooks.');
      }

      const body = webhookSchema.parse(req.body);
      if (body.event !== 'sms:received') return { ok: true, ignored: 'event' };
      const phone = normalizePhone(body.payload.sender ?? body.payload.phoneNumber ?? '', ctx.config.defaultCountry);
      // Alphanumeric senders (banks, operators) are not people who can sign up.
      if (!phone) return { ok: true, ignored: 'sender' };
      const text = body.payload.message;

      const reply = (message: string, userId?: string) =>
        enqueueJob(ctx.db, 'sms.send', { to: phone.e164, body: message, purpose: 'welcome', userId }, { maxAttempts: 3 });

      if (HELP_RE.test(text)) {
        await reply('PhoneMail: text JOIN to this number to get a free email address for your phone number.');
        return { ok: true, action: 'help' };
      }
      if (!JOIN_RE.test(text)) return { ok: true, ignored: 'text' };

      const { user, created } = await findOrCreateUser(ctx, phone.e164, 'sms');
      await reply(
        created ? welcomeText(ctx, user.address) : `You already have a PhoneMail account: ${user.address}. Sign in at ${ctx.config.publicWebUrl}`,
        user.id,
      );
      return { ok: true, action: created ? 'created' : 'exists', address: user.address };
    });
  });
}
