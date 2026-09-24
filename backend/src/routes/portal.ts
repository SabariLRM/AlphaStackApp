import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { conflict } from '../lib/errors.js';
import { enqueueJob } from '../services/jobs.js';
import { welcomeText } from '../services/notify.js';
import { requestOtp, verifyOtp } from '../services/otp.js';
import { findOrCreateUser } from '../services/users.js';

/** Registration-only portal: phone number + OTP creates an account, nothing else. */
export async function portalRoutes(app: FastifyInstance, ctx: AppContext) {
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/api/portal/otp/request', strict, async (req) => {
    const body = z.object({ phone: z.string().min(3).max(32) }).parse(req.body);
    return requestOtp(ctx, { phone: body.phone, purpose: 'register', ip: req.ip });
  });

  app.post('/api/portal/register', strict, async (req) => {
    const body = z.object({ phone: z.string().min(3).max(32), code: z.string().min(4).max(10) }).parse(req.body);
    const phone = await verifyOtp(ctx, { phone: body.phone, code: body.code, purpose: 'register' });
    const { user, created } = await findOrCreateUser(ctx, phone, 'portal');
    if (!created) throw conflict('account_exists', 'An account already exists for this phone number.');
    await enqueueJob(ctx.db, 'sms.send', { to: user.phone, body: welcomeText(ctx, user.address), purpose: 'welcome', userId: user.id }, { maxAttempts: 3 });
    return { address: user.address, phone: user.phone };
  });
}
