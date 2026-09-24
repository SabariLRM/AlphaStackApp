import { many, one, type DbClient } from '../db/pool.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

export type ClientKind = 'web' | 'mobile';

export const SESSION_DAYS: Record<ClientKind, number> = { web: 30, mobile: 180 };

export interface SessionRow {
  id: string;
  user_id: string;
  client: ClientKind;
  device_name: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function createSession(
  db: DbClient,
  input: { userId: string; client: ClientKind; deviceName: string; ip?: string; userAgent?: string },
): Promise<{ token: string; session: SessionRow }> {
  const token = randomToken(32);
  const session = await one<SessionRow>(
    db,
    `INSERT INTO sessions (user_id, token_hash, client, device_name, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7)) RETURNING *`,
    [input.userId, sha256Hex(token), input.client, input.deviceName.slice(0, 120), input.ip ?? null, (input.userAgent ?? '').slice(0, 300), SESSION_DAYS[input.client]],
  );
  return { token, session: session! };
}

export async function findSessionByToken(db: DbClient, token: string): Promise<SessionRow | undefined> {
  if (!token || token.length > 128) return undefined;
  return one<SessionRow>(
    db,
    `SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256Hex(token)],
  );
}

/** Updates last_seen_at at most once a minute to avoid a write on every request. */
export async function touchSession(db: DbClient, session: SessionRow, ip?: string): Promise<void> {
  if (Date.now() - session.last_seen_at.getTime() < 60_000) return;
  await db.query('UPDATE sessions SET last_seen_at = now(), ip = COALESCE($2, ip) WHERE id = $1', [session.id, ip ?? null]);
}

export async function revokeSession(db: DbClient, userId: string, sessionId: string): Promise<boolean> {
  const res = await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [sessionId, userId]);
  return (res.rowCount ?? 0) > 0;
}

export async function listSessions(db: DbClient, userId: string): Promise<SessionRow[]> {
  return many<SessionRow>(
    db,
    `SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
    [userId],
  );
}
