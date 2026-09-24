import type { AppContext } from '../../context.js';
import { many, withTransaction, type DbClient } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getConversation } from './participants.js';

export type MoveTarget = 'inbox' | 'trash' | 'spam' | 'restore';

interface TouchedRow {
  id: string;
  conversation_id: string;
}

function publishUpdated(ctx: AppContext, userId: string, rows: TouchedRow[]) {
  if (!rows.length) return;
  ctx.realtime.publish(userId, {
    type: 'entries.updated',
    entryIds: rows.map((r) => r.id),
    conversationIds: [...new Set(rows.map((r) => r.conversation_id))],
  });
}

export async function setFlags(ctx: AppContext, userId: string, entryIds: string[], flags: { isRead?: boolean; isStarred?: boolean }): Promise<number> {
  if (!entryIds.length || (flags.isRead === undefined && flags.isStarred === undefined)) return 0;
  const rows = await many<TouchedRow>(
    ctx.db,
    `UPDATE mailbox_entries SET is_read = COALESCE($3, is_read), is_starred = COALESCE($4, is_starred)
      WHERE user_id = $1 AND id = ANY($2::uuid[]) RETURNING id, conversation_id`,
    [userId, entryIds, flags.isRead ?? null, flags.isStarred ?? null],
  );
  publishUpdated(ctx, userId, rows);
  return rows.length;
}

async function addSpamSenders(db: DbClient, userId: string, entryIds: string[]) {
  await db.query(
    `INSERT INTO spam_senders (user_id, address)
     SELECT DISTINCT $1::uuid, e.from_address FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
      WHERE me.user_id = $1 AND me.id = ANY($2::uuid[]) AND me.direction = 'in'
     ON CONFLICT DO NOTHING`,
    [userId, entryIds],
  );
}

export async function moveEntries(ctx: AppContext, userId: string, entryIds: string[], target: MoveTarget): Promise<number> {
  if (!entryIds.length) return 0;
  const rows = await withTransaction(ctx.db, async (tx) => {
    switch (target) {
      case 'trash':
        return many<TouchedRow>(
          tx,
          `UPDATE mailbox_entries SET previous_folder = folder, folder = 'trash', trashed_at = now()
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND folder <> 'trash' RETURNING id, conversation_id`,
          [userId, entryIds],
        );
      case 'restore':
        return many<TouchedRow>(
          tx,
          `UPDATE mailbox_entries
              SET folder = COALESCE(previous_folder, CASE WHEN direction = 'out' THEN 'sent' ELSE 'inbox' END),
                  previous_folder = NULL, trashed_at = NULL
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND folder = 'trash' RETURNING id, conversation_id`,
          [userId, entryIds],
        );
      case 'spam': {
        // Reporting spam blocks the sender: their future mail goes straight to Spam.
        await addSpamSenders(tx, userId, entryIds);
        return many<TouchedRow>(
          tx,
          `UPDATE mailbox_entries
              SET previous_folder = CASE WHEN folder = 'trash' THEN previous_folder ELSE folder END,
                  folder = 'spam', is_read = true, trashed_at = NULL
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND direction = 'in' AND folder IN ('inbox', 'trash')
            RETURNING id, conversation_id`,
          [userId, entryIds],
        );
      }
      case 'inbox': {
        // "Not spam": unblock the senders and move the selected mail back to the Inbox.
        await tx.query(
          `DELETE FROM spam_senders s USING mailbox_entries me JOIN emails e ON e.id = me.email_id
            WHERE s.user_id = $1 AND me.user_id = $1 AND me.id = ANY($2::uuid[]) AND s.address = e.from_address`,
          [userId, entryIds],
        );
        return many<TouchedRow>(
          tx,
          `UPDATE mailbox_entries SET folder = 'inbox', previous_folder = NULL, trashed_at = NULL
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND direction = 'in' AND folder IN ('spam', 'trash')
            RETURNING id, conversation_id`,
          [userId, entryIds],
        );
      }
      default:
        throw badRequest('invalid_folder', 'Unknown folder.');
    }
  });
  publishUpdated(ctx, userId, rows);
  return rows.length;
}

/** Permanently deletes entries (only from Trash or Spam). Orphaned emails are garbage-collected later. */
export async function deleteForever(ctx: AppContext, userId: string, entryIds: string[]): Promise<number> {
  if (!entryIds.length) return 0;
  const rows = await many<TouchedRow>(
    ctx.db,
    `DELETE FROM mailbox_entries WHERE user_id = $1 AND id = ANY($2::uuid[]) AND folder IN ('trash', 'spam') RETURNING id, conversation_id`,
    [userId, entryIds],
  );
  publishUpdated(ctx, userId, rows);
  return rows.length;
}

export async function emptyFolder(ctx: AppContext, userId: string, folder: 'trash' | 'spam'): Promise<number> {
  const rows = await many<TouchedRow>(ctx.db, `DELETE FROM mailbox_entries WHERE user_id = $1 AND folder = $2 RETURNING id, conversation_id`, [userId, folder]);
  publishUpdated(ctx, userId, rows);
  return rows.length;
}

async function conversationEntryIds(ctx: AppContext, userId: string, conversationId: string, folders: string[]): Promise<string[]> {
  const conversation = await getConversation(ctx.db, userId, conversationId);
  if (!conversation) throw notFound('Chat not found.');
  const rows = await many<{ id: string }>(
    ctx.db,
    'SELECT id FROM mailbox_entries WHERE user_id = $1 AND conversation_id = $2 AND folder = ANY($3)',
    [userId, conversationId, folders],
  );
  return rows.map((r) => r.id);
}

export async function markConversationRead(ctx: AppContext, userId: string, conversationId: string, isRead = true): Promise<number> {
  const ids = await conversationEntryIds(ctx, userId, conversationId, ['inbox']);
  if (!isRead) {
    // "Mark as unread" flags only the latest received email, like WhatsApp/Gmail.
    const latest = await many<{ id: string }>(
      ctx.db,
      `SELECT id FROM mailbox_entries WHERE user_id = $1 AND conversation_id = $2 AND folder = 'inbox' ORDER BY sent_at DESC LIMIT 1`,
      [userId, conversationId],
    );
    return setFlags(ctx, userId, latest.map((r) => r.id), { isRead: false });
  }
  return setFlags(ctx, userId, ids, { isRead: true });
}

export async function trashConversation(ctx: AppContext, userId: string, conversationId: string): Promise<number> {
  const ids = await conversationEntryIds(ctx, userId, conversationId, ['inbox', 'sent']);
  await ctx.db.query('DELETE FROM drafts WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]);
  const n = await moveEntries(ctx, userId, ids, 'trash');
  ctx.realtime.publish(userId, { type: 'conversation.updated', conversationId });
  return n;
}

export async function reportConversationSpam(ctx: AppContext, userId: string, conversationId: string): Promise<number> {
  const ids = await conversationEntryIds(ctx, userId, conversationId, ['inbox']);
  const n = await moveEntries(ctx, userId, ids, 'spam');
  ctx.realtime.publish(userId, { type: 'conversation.updated', conversationId });
  return n;
}

export async function setConversationFavorite(ctx: AppContext, userId: string, conversationId: string, isFavorite: boolean): Promise<void> {
  const res = await ctx.db.query('UPDATE conversations SET is_favorite = $3 WHERE id = $1 AND user_id = $2', [conversationId, userId, isFavorite]);
  if (!res.rowCount) throw notFound('Chat not found.');
  ctx.realtime.publish(userId, { type: 'conversation.updated', conversationId });
}
