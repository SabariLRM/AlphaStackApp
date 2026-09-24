import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import { many } from '../db/pool.js';
import { badRequest, notFound, payloadTooLarge, unprocessable } from '../lib/errors.js';
import { singleLine } from '../lib/html.js';
import { normalizePhone } from '../lib/phone.js';
import { listSessions, revokeSession } from '../services/sessions.js';
import { addAlias, getUserAddresses, getUserById, hasActiveMobileApp, removeAlias, toMe, updateProfile } from '../services/users.js';
import { currentUser, idParams, SUPPORTED_LANGUAGES } from './util.js';

const profileSchema = z.object({
  displayName: z.string().max(60).transform(singleLine).optional(),
  about: z.string().max(140).transform(singleLine).optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  signature: z.string().max(2000).optional(),
  smsNotifications: z.boolean().optional(),
});

/** Magic numbers for the image types we accept as profile pictures. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

export async function meRoutes(app: FastifyInstance, ctx: AppContext) {
  const meDto = async (userId: string) => {
    const user = await getUserById(ctx.db, userId);
    if (!user) throw notFound('Account not found.');
    return toMe(user, await getUserAddresses(ctx.db, user.id), await hasActiveMobileApp(ctx, user.id));
  };

  app.get('/api/me', async (req) => meDto(requireAuth(req).userId));

  app.patch('/api/me', async (req) => {
    const auth = requireAuth(req);
    const body = profileSchema.parse(req.body);
    await updateProfile(ctx.db, auth.userId, body);
    ctx.realtime.publish(auth.userId, { type: 'profile.updated' });
    return meDto(auth.userId);
  });

  app.delete('/api/me', async (req, reply) => {
    const user = await currentUser(ctx, req);
    const body = z.object({ confirmPhone: z.string() }).parse(req.body);
    if (normalizePhone(body.confirmPhone, ctx.config.defaultCountry)?.e164 !== user.phone) {
      throw unprocessable('confirm_mismatch', 'Type your phone number to confirm account deletion.');
    }
    await ctx.db.query('DELETE FROM users WHERE id = $1', [user.id]);
    if (user.avatar_key) await ctx.storage.remove(user.avatar_key).catch(() => undefined);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    ctx.log.info({ userId: user.id }, 'account deleted');
    return { ok: true };
  });

  app.put('/api/me/avatar', async (req) => {
    const user = await currentUser(ctx, req);
    const file = await req.file({ limits: { fileSize: ctx.config.maxAvatarBytes } });
    if (!file) throw badRequest('no_file', 'Choose an image to upload.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.file) {
      size += (chunk as Buffer).length;
      if (size > ctx.config.maxAvatarBytes) throw payloadTooLarge('Profile photos must be smaller than 2 MB.');
      chunks.push(chunk as Buffer);
    }
    if (file.file.truncated) throw payloadTooLarge('Profile photos must be smaller than 2 MB.');
    const data = Buffer.concat(chunks);
    if (!sniffImage(data)) throw unprocessable('invalid_image', 'Profile photo must be a JPEG, PNG, WebP or GIF image.');
    const key = await ctx.storage.saveBuffer('avatars', data);
    await ctx.db.query('UPDATE users SET avatar_key = $2, avatar_updated_at = now(), updated_at = now() WHERE id = $1', [user.id, key]);
    if (user.avatar_key) await ctx.storage.remove(user.avatar_key).catch(() => undefined);
    ctx.realtime.publish(user.id, { type: 'profile.updated' });
    return meDto(user.id);
  });

  app.delete('/api/me/avatar', async (req) => {
    const user = await currentUser(ctx, req);
    await ctx.db.query('UPDATE users SET avatar_key = NULL, avatar_updated_at = now(), updated_at = now() WHERE id = $1', [user.id]);
    if (user.avatar_key) await ctx.storage.remove(user.avatar_key).catch(() => undefined);
    ctx.realtime.publish(user.id, { type: 'profile.updated' });
    return meDto(user.id);
  });

  // Profile pictures are public (like on WhatsApp): anyone you email can see yours.
  app.get('/api/avatars/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const user = await getUserById(ctx.db, id);
    if (!user?.avatar_key || !(await ctx.storage.exists(user.avatar_key))) throw notFound('No profile photo.');
    const head = await new Promise<Buffer>((resolve, reject) => {
      const s = ctx.storage.open(user.avatar_key!);
      const parts: Buffer[] = [];
      s.on('data', (c: Buffer) => parts.push(c));
      s.on('end', () => resolve(Buffer.concat(parts)));
      s.on('error', reject);
    });
    reply.header('Content-Type', sniffImage(head) ?? 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(head);
  });

  app.get('/api/me/aliases', async (req) => {
    const auth = requireAuth(req);
    const rows = await getUserAddresses(ctx.db, auth.userId);
    return { items: rows.map((r) => ({ address: r.address, kind: r.kind, createdAt: r.created_at.toISOString() })) };
  });

  app.post('/api/me/aliases', async (req) => {
    const auth = requireAuth(req);
    const body = z.object({ alias: z.string().min(1).max(100) }).parse(req.body);
    const address = await addAlias(ctx, auth.userId, body.alias);
    ctx.realtime.publish(auth.userId, { type: 'profile.updated' });
    return { address };
  });

  app.delete('/api/me/aliases/:address', async (req) => {
    const auth = requireAuth(req);
    const { address } = z.object({ address: z.string().min(3).max(320) }).parse(req.params);
    await removeAlias(ctx.db, auth.userId, address);
    ctx.realtime.publish(auth.userId, { type: 'profile.updated' });
    return { ok: true };
  });

  app.get('/api/me/sessions', async (req) => {
    const auth = requireAuth(req);
    const rows = await listSessions(ctx.db, auth.userId);
    return {
      items: rows.map((s) => ({
        id: s.id,
        client: s.client,
        deviceName: s.device_name,
        ip: s.ip,
        createdAt: s.created_at.toISOString(),
        lastSeenAt: s.last_seen_at.toISOString(),
        current: s.id === auth.sessionId,
      })),
    };
  });

  app.delete('/api/me/sessions/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    if (!(await revokeSession(ctx.db, auth.userId, id))) throw notFound('Session not found.');
    return { ok: true };
  });

  app.get('/api/me/blocked', async (req) => {
    const auth = requireAuth(req);
    const rows = await many<{ address: string; created_at: Date }>(ctx.db, 'SELECT address, created_at FROM spam_senders WHERE user_id = $1 ORDER BY created_at DESC', [auth.userId]);
    return { items: rows.map((r) => ({ address: r.address, createdAt: r.created_at.toISOString() })) };
  });

  app.delete('/api/me/blocked/:address', async (req) => {
    const auth = requireAuth(req);
    const { address } = z.object({ address: z.string().min(3).max(320) }).parse(req.params);
    await ctx.db.query('DELETE FROM spam_senders WHERE user_id = $1 AND address = $2', [auth.userId, address.toLowerCase()]);
    return { ok: true };
  });

}
