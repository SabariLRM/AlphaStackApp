import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth.js';
import type { AppContext } from '../context.js';
import { requestOtp, verifyOtp } from '../services/otp.js';
import { createSession, revokeSession, SESSION_DAYS } from '../services/sessions.js';
import { findOrCreateUser, getUserAddresses, hasActiveMobileApp, toMe } from '../services/users.js';

const requestSchema = z.object({
  phone: z.string().min(3).max(32),
  appHash: z.string().max(20).optional(),
});

const verifySchema = z.object({
  phone: z.string().min(3).max(32),
  code: z.string().min(4).max(10),
  client: z.enum(['web', 'mobile']).default('web'),
  deviceName: z.string().max(120).optional(),
});

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/api/auth/otp/request', strict, async (req) => {
    const body = requestSchema.parse(req.body);
    return requestOtp(ctx, { phone: body.phone, purpose: 'login', ip: req.ip, appHash: body.appHash });
  });

  app.post('/api/auth/otp/verify', strict, async (req, reply) => {
    const body = verifySchema.parse(req.body);
    const phone = await verifyOtp(ctx, { phone: body.phone, code: body.code, purpose: 'login' });
    const { user, created } = await findOrCreateUser(ctx, phone, body.client === 'mobile' ? 'mobile' : 'web');
    const deviceName = body.deviceName?.trim() || (body.client === 'mobile' ? 'Android phone' : describeBrowser(req.headers['user-agent']));
    const { token } = await createSession(ctx.db, {
      userId: user.id,
      client: body.client,
      deviceName,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const me = toMe(user, await getUserAddresses(ctx.db, user.id), await hasActiveMobileApp(ctx, user.id));
    if (body.client === 'web') {
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: ctx.config.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_DAYS.web * 24 * 3600,
      });
      return { user: me, isNewUser: created };
    }
    return { token, user: me, isNewUser: created };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await revokeSession(ctx.db, req.auth.userId, req.auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}

export function describeBrowser(ua: string | undefined): string {
  if (!ua) return 'Web browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
