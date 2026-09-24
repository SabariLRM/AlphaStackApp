import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { checkRecipient, deliverInbound, inboundSchema } from '../services/mail/inbound.js';

/** Endpoints used by the Go SMTP server. Never exposed through nginx; guarded by a shared token. */
export async function internalRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = async (req: FastifyRequest) => {
    const token = req.headers['x-internal-token'];
    if (typeof token !== 'string' || !safeEqual(token, ctx.config.internalToken)) throw new AppError(401, 'unauthorized', 'Invalid internal token.');
  };
  const opts = { preHandler: guard, config: { rateLimit: false as const } };

  app.post('/internal/smtp/rcpt', opts, async (req, reply) => {
    const { address } = z.object({ address: z.string().max(320) }).parse(req.body);
    const user = await checkRecipient(ctx, address);
    if (!user) return reply.status(404).send({ ok: false });
    return { ok: true, primary: user.address };
  });

  app.post('/internal/smtp/deliver', { ...opts, bodyLimit: 80 * 1024 * 1024 }, async (req) => {
    const payload = inboundSchema.parse(req.body);
    return deliverInbound(ctx, payload);
  });
}
