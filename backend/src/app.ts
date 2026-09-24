import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { CSRF_HEADER, SESSION_COOKIE } from './auth.js';
import { AppError } from './lib/errors.js';
import { findSessionByToken, touchSession } from './services/sessions.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { contactRoutes } from './routes/contacts.js';
import { conversationRoutes } from './routes/conversations.js';
import { devRoutes } from './routes/dev.js';
import { draftRoutes } from './routes/drafts.js';
import { internalRoutes } from './routes/internal.js';
import { meRoutes } from './routes/me.js';
import { messageRoutes } from './routes/messages.js';
import { metaRoutes } from './routes/meta.js';
import { portalRoutes } from './routes/portal.js';
import { smsgateRoutes } from './routes/smsgate.js';
import { twilioRoutes } from './routes/twilio.js';
import { wsRoutes } from './routes/ws.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Endpoints that never act on a signed-in user: a session cookie sent along (browsers share
// cookies between localhost ports) must not trigger the CSRF check there.
const PUBLIC_PREFIXES = ['/api/portal/', '/api/auth/otp/', '/api/twilio/', '/api/smsgate/', '/api/config', '/api/health'];

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: ctx.config.logLevel },
    // Only the nginx containers on the private Docker network may set X-Forwarded-For.
    trustProxy: 'loopback,linklocal,uniquelocal',
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: ctx.config.maxAttachmentBytes, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
    let token: string | undefined;
    let viaCookie = false;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
    } else if (req.cookies[SESSION_COOKIE]) {
      token = req.cookies[SESSION_COOKIE];
      viaCookie = true;
    }
    if (!token) return;
    const session = await findSessionByToken(ctx.db, token);
    if (!session) return;
    // Cookie sessions must prove the request came from our own pages (blocks CSRF).
    if (viaCookie && !SAFE_METHODS.has(req.method) && !req.headers[CSRF_HEADER]) {
      throw new AppError(403, 'csrf', 'Missing request header.');
    }
    req.auth = { userId: session.user_id, sessionId: session.id, client: session.client, viaCookie };
    await touchSession(ctx.db, session, req.ip);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode === 429 && err.details?.retryAfter) reply.header('Retry-After', String(err.details.retryAfter));
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path.join('.');
      return reply.status(400).send({ error: { code: 'validation', message: issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid request.' } });
    }
    const e = err as { statusCode?: number; code?: string; message: string; validation?: unknown };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'payload_too_large', message: 'That file or request is too large.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url.split('?')[0]}` } }));

  await app.register(async (api) => {
    await metaRoutes(api, ctx);
    await authRoutes(api, ctx);
    await portalRoutes(api, ctx);
    await meRoutes(api, ctx);
    await conversationRoutes(api, ctx);
    await messageRoutes(api, ctx);
    await draftRoutes(api, ctx);
    await attachmentRoutes(api, ctx);
    await contactRoutes(api, ctx);
    await twilioRoutes(api, ctx);
    await smsgateRoutes(api, ctx);
    await devRoutes(api, ctx);
    await wsRoutes(api, ctx);
  });
  await app.register(async (internal) => internalRoutes(internal, ctx));

  return app;
}
