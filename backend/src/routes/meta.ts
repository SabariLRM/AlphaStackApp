import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { safeCallingCode } from '../lib/phone.js';

export async function metaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { config } = ctx;
  app.get('/api/health', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true };
  });

  app.get('/api/config', async () => ({
    mailDomain: config.mailDomain,
    defaultCountry: config.defaultCountry,
    defaultCallingCode: safeCallingCode(config.defaultCountry) ?? '',
    otpLength: config.otp.provider === 'twilio_verify' ? 6 : config.otp.length,
    otpResendSeconds: config.otp.resendSeconds,
    smsProvider: config.sms.provider,
    otpProvider: config.otp.provider,
    devSmsOutbox: config.sms.devOutbox,
    externalMail: !!config.smtpRelayUrl,
    maxAttachmentBytes: config.maxAttachmentBytes,
    webUrl: config.publicWebUrl,
    portalUrl: config.publicPortalUrl,
  }));
}
