import { many, one, type DbClient } from '../../db/pool.js';
import { avatarUrl } from '../users.js';

export interface ConversationRow {
  id: string;
  user_id: string;
  participant_key: string;
  participants: string[];
  is_group: boolean;
  is_favorite: boolean;
  last_activity_at: Date;
  created_at: Date;
}

interface AddressOwner {
  lookup: string;
  user_id: string;
  primary_address: string;
}

async function ownersOf(db: DbClient, addresses: string[]): Promise<Map<string, AddressOwner>> {
  if (addresses.length === 0) return new Map();
  const rows = await many<AddressOwner>(
    db,
    `SELECT a.address AS lookup, a.user_id, u.address AS primary_address
       FROM addresses a JOIN users u ON u.id = a.user_id WHERE a.address = ANY($1)`,
    [addresses],
  );
  return new Map(rows.map((r) => [r.lookup, r]));
}

/**
 * The chat an email belongs to, from one user's point of view: everyone on From/To/Cc except the
 * user. Local aliases are folded into their owner's primary address so that mail to/from an alias
 * lands in the same chat. An email only involving the user themself maps to their "self" chat.
 */
export async function participantsFor(db: DbClient, self: { id: string; address: string }, addresses: string[]): Promise<string[]> {
  const lower = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  const owners = await ownersOf(db, lower);
  const result = new Set<string>();
  for (const address of lower) {
    const owner = owners.get(address);
    if (owner) {
      if (owner.user_id !== self.id) result.add(owner.primary_address);
    } else {
      result.add(address);
    }
  }
  if (result.size === 0) return [self.address];
  return [...result].sort();
}

export async function getOrCreateConversation(db: DbClient, userId: string, participants: string[]): Promise<ConversationRow> {
  const row = await one<ConversationRow>(
    db,
    `INSERT INTO conversations (user_id, participant_key, participants, is_group)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, participant_key) DO UPDATE SET participants = EXCLUDED.participants
     RETURNING *`,
    [userId, participants.join(','), participants, participants.length > 1],
  );
  return row!;
}

export async function getConversation(db: DbClient, userId: string, conversationId: string): Promise<ConversationRow | undefined> {
  return one<ConversationRow>(db, 'SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, userId]);
}

export interface ParticipantInfo {
  address: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  userId: string | null;
  isLocal: boolean;
}

/** Display info for addresses: PhoneMail profile for local users, last seen "From" name for others. */
export async function describeAddresses(db: DbClient, addresses: string[], mailDomain: string): Promise<Map<string, ParticipantInfo>> {
  const lower = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, ParticipantInfo>();
  if (lower.length === 0) return out;
  const users = await many<{
    lookup: string;
    id: string;
    display_name: string;
    phone: string;
    avatar_key: string | null;
    avatar_updated_at: Date | null;
  }>(
    db,
    `SELECT a.address AS lookup, u.id, u.display_name, u.phone, u.avatar_key, u.avatar_updated_at
       FROM addresses a JOIN users u ON u.id = a.user_id WHERE a.address = ANY($1)`,
    [lower],
  );
  for (const u of users) {
    out.set(u.lookup, { address: u.lookup, name: u.display_name, phone: u.phone, avatarUrl: avatarUrl(u), userId: u.id, isLocal: true });
  }
  const externals = lower.filter((a) => !out.has(a));
  if (externals.length) {
    const names = await many<{ from_address: string; from_name: string }>(
      db,
      `SELECT DISTINCT ON (from_address) from_address, from_name FROM emails
        WHERE from_address = ANY($1) AND from_name <> '' ORDER BY from_address, sent_at DESC`,
      [externals],
    );
    const byAddress = new Map(names.map((n) => [n.from_address, n.from_name]));
    for (const address of externals) {
      out.set(address, {
        address,
        name: byAddress.get(address) ?? '',
        phone: null,
        avatarUrl: null,
        userId: null,
        isLocal: address.endsWith(`@${mailDomain}`),
      });
    }
  }
  return out;
}
