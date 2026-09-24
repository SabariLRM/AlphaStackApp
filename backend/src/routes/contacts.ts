import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { many } from '../db/pool.js';
import { domainOf, normalizeAddress } from '../lib/address.js';
import { looksLikePhone, normalizePhone } from '../lib/phone.js';
import { avatarUrl, getUserByPhone, resolveLocalAddress } from '../services/users.js';
import { currentUser } from './util.js';

export async function contactRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Resolves what the user typed in the search bar to a PhoneMail account (or a valid external address). */
  app.get('/api/lookup', async (req) => {
    await currentUser(ctx, req);
    const { q } = z.object({ q: z.string().min(1).max(320) }).parse(req.query);
    const value = q.trim();
    let user;
    let address: string | null = null;
    let phone: string | null = null;
    if (value.includes('@')) {
      address = normalizeAddress(value);
      if (address && domainOf(address) === ctx.config.mailDomain) user = await resolveLocalAddress(ctx.db, address);
    } else if (looksLikePhone(value)) {
      phone = normalizePhone(value, ctx.config.defaultCountry)?.e164 ?? null;
      if (phone) user = await getUserByPhone(ctx.db, phone);
    }
    if (user) {
      return {
        found: true,
        registered: true,
        address: user.address,
        phone: user.phone,
        name: user.display_name,
        avatarUrl: avatarUrl(user),
      };
    }
    const external = !!address && domainOf(address) !== ctx.config.mailDomain;
    return {
      found: external && !!ctx.config.smtpRelayUrl,
      registered: false,
      address: external ? address : null,
      phone,
      name: '',
      avatarUrl: null,
    };
  });

  /** Which of the device's contacts are on PhoneMail (used by the Android app to show names). */
  app.post('/api/contacts/match', async (req) => {
    await currentUser(ctx, req);
    const { phones } = z.object({ phones: z.array(z.string().max(40)).max(5000) }).parse(req.body);
    const normalized = new Map<string, string[]>();
    for (const raw of phones) {
      const e164 = normalizePhone(raw, ctx.config.defaultCountry)?.e164;
      if (!e164) continue;
      normalized.set(e164, [...(normalized.get(e164) ?? []), raw]);
    }
    if (!normalized.size) return { items: [] };
    const rows = await many<{ id: string; phone: string; address: string; display_name: string; about: string; avatar_key: string | null; avatar_updated_at: Date | null }>(
      ctx.db,
      'SELECT id, phone, address, display_name, about, avatar_key, avatar_updated_at FROM users WHERE phone = ANY($1)',
      [[...normalized.keys()]],
    );
    return {
      items: rows.map((r) => ({
        phone: r.phone,
        inputs: normalized.get(r.phone) ?? [],
        address: r.address,
        name: r.display_name,
        about: r.about,
        avatarUrl: avatarUrl(r),
      })),
    };
  });
}
