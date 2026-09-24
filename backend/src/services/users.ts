import type { AppContext } from '../context.js';
import { many, one, withTransaction, type DbClient } from '../db/pool.js';
import { normalizeAddress, validateAliasLocalPart } from '../lib/address.js';
import { badRequest, conflict, isUniqueViolation, notFound, unprocessable } from '../lib/errors.js';
import { normalizePhone, phoneLocalPart } from '../lib/phone.js';

export type RegistrationSource = 'mobile' | 'web' | 'portal' | 'ivr' | 'sms';

export interface UserRow {
  id: string;
  phone: string;
  address: string;
  display_name: string;
  about: string;
  language: string;
  signature: string;
  avatar_key: string | null;
  avatar_updated_at: Date | null;
  sms_notifications: boolean;
  registration_source: RegistrationSource;
  created_at: Date;
  updated_at: Date;
}

export const MAX_ALIASES = 5;

export const avatarUrl = (u: Pick<UserRow, 'id' | 'avatar_key' | 'avatar_updated_at'>) =>
  u.avatar_key ? `/api/avatars/${u.id}?v=${u.avatar_updated_at ? u.avatar_updated_at.getTime() : 0}` : null;

export async function getUserById(db: DbClient, id: string): Promise<UserRow | undefined> {
  return one<UserRow>(db, 'SELECT * FROM users WHERE id = $1', [id]);
}

export async function getUserByPhone(db: DbClient, e164: string): Promise<UserRow | undefined> {
  return one<UserRow>(db, 'SELECT * FROM users WHERE phone = $1', [e164]);
}

/** Resolves any local address (primary or alias) to its owner. */
export async function resolveLocalAddress(db: DbClient, address: string): Promise<UserRow | undefined> {
  return one<UserRow>(db, 'SELECT u.* FROM addresses a JOIN users u ON u.id = a.user_id WHERE a.address = $1', [address.toLowerCase()]);
}

export async function getUserAddresses(db: DbClient, userId: string): Promise<{ address: string; kind: 'primary' | 'alias'; created_at: Date }[]> {
  return many(db, `SELECT address, kind, created_at FROM addresses WHERE user_id = $1 ORDER BY kind = 'primary' DESC, created_at`, [userId]);
}

export interface CreateUserResult {
  user: UserRow;
  created: boolean;
}

/** Creates the account for a phone number, or returns the existing one. Safe under concurrent calls. */
export async function findOrCreateUser(ctx: AppContext, e164: string, source: RegistrationSource): Promise<CreateUserResult> {
  const existing = await getUserByPhone(ctx.db, e164);
  if (existing) return { user: existing, created: false };

  const phone = normalizePhone(e164, ctx.config.defaultCountry);
  if (!phone) throw badRequest('invalid_phone', 'That phone number is not valid.');
  const preferred = `${phoneLocalPart(phone, ctx.config.defaultCountry)}@${ctx.config.mailDomain}`;
  // A home-country national number can, in rare cases, equal another country's full digits.
  // "00" + international digits can never be a national number, so it is a safe fallback.
  const candidates = [preferred, `00${phone.e164.slice(1)}@${ctx.config.mailDomain}`];

  for (const address of candidates) {
    try {
      const user = await withTransaction(ctx.db, async (tx) => {
        const row = await one<UserRow>(
          tx,
          `INSERT INTO users (phone, address, registration_source) VALUES ($1, $2, $3) RETURNING *`,
          [phone.e164, address, source],
        );
        await tx.query(`INSERT INTO addresses (address, user_id, kind) VALUES ($1, $2, 'primary')`, [address, row!.id]);
        return row!;
      });
      ctx.log.info({ userId: user.id, address, source }, 'account created');
      return { user, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Another request created this phone number concurrently.
      const raced = await getUserByPhone(ctx.db, phone.e164);
      if (raced) return { user: raced, created: false };
      // Otherwise the address itself collided: try the next candidate.
    }
  }
  throw conflict('address_unavailable', 'Could not allocate an address for this phone number.');
}

export interface ProfileUpdate {
  displayName?: string;
  about?: string;
  language?: string;
  signature?: string;
  smsNotifications?: boolean;
}

export async function updateProfile(db: DbClient, userId: string, patch: ProfileUpdate): Promise<UserRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.displayName !== undefined) add('display_name', patch.displayName);
  if (patch.about !== undefined) add('about', patch.about);
  if (patch.language !== undefined) add('language', patch.language);
  if (patch.signature !== undefined) add('signature', patch.signature);
  if (patch.smsNotifications !== undefined) add('sms_notifications', patch.smsNotifications);
  params.push(userId);
  const row = await one<UserRow>(
    db,
    `UPDATE users SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!row) throw notFound('Account not found.');
  return row;
}

export async function addAlias(ctx: AppContext, userId: string, localPartInput: string): Promise<string> {
  const localPart = localPartInput.trim().toLowerCase().replace(new RegExp(`@${ctx.config.mailDomain.replace(/\./g, '\\.')}$`), '');
  const problem = validateAliasLocalPart(localPart);
  if (problem) throw unprocessable('invalid_alias', problem);
  const address = normalizeAddress(`${localPart}@${ctx.config.mailDomain}`);
  if (!address) throw unprocessable('invalid_alias', 'That alias is not a valid address.');

  return withTransaction(ctx.db, async (tx) => {
    // Serialize alias changes per user so the limit cannot be exceeded by parallel requests.
    await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const count = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM addresses WHERE user_id = $1 AND kind = 'alias'`, [userId]);
    if ((count?.n ?? 0) >= MAX_ALIASES) throw unprocessable('alias_limit', `You can have at most ${MAX_ALIASES} aliases.`);
    try {
      await tx.query(`INSERT INTO addresses (address, user_id, kind) VALUES ($1, $2, 'alias')`, [address, userId]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('alias_taken', 'That alias is already taken.');
      throw err;
    }
    return address;
  });
}

export async function removeAlias(db: DbClient, userId: string, address: string): Promise<void> {
  const res = await db.query(`DELETE FROM addresses WHERE user_id = $1 AND address = $2 AND kind = 'alias'`, [userId, address.toLowerCase()]);
  if (!res.rowCount) throw notFound('Alias not found.');
}

/** A user "has the mobile app" while a mobile session has been used recently. */
export async function hasActiveMobileApp(ctx: AppContext, userId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    ctx.db,
    `SELECT count(*)::int AS n FROM sessions
      WHERE user_id = $1 AND client = 'mobile' AND revoked_at IS NULL AND expires_at > now()
        AND last_seen_at > now() - make_interval(days => $2)`,
    [userId, ctx.config.mobileActiveDays],
  );
  return (row?.n ?? 0) > 0;
}

export function toMe(user: UserRow, addresses: { address: string; kind: string }[], hasMobileApp: boolean) {
  return {
    id: user.id,
    phone: user.phone,
    address: user.address,
    displayName: user.display_name,
    about: user.about,
    language: user.language,
    signature: user.signature,
    avatarUrl: avatarUrl(user),
    smsNotifications: user.sms_notifications,
    registrationSource: user.registration_source,
    aliases: addresses.filter((a) => a.kind === 'alias').map((a) => a.address),
    hasMobileApp,
    createdAt: user.created_at.toISOString(),
  };
}
