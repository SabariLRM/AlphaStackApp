import type { AppContext } from '../../context.js';
import { many, one, withTransaction } from '../../db/pool.js';
import { isUniqueViolation, notFound, unprocessable } from '../../lib/errors.js';
import { singleLine } from '../../lib/html.js';
import { signAttachment, lockUploads, type AttachmentRow } from './attachments.js';
import { describeAddresses, getConversation } from './participants.js';
import { MAX_BODY, MAX_RECIPIENTS, MAX_SUBJECT } from './send.js';

export interface DraftInput {
  conversationId?: string | null;
  replyToEntryId?: string | null;
  fromAddress?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachmentIds?: string[];
}

interface DraftRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  reply_to_entry_id: string | null;
  from_address: string | null;
  to_list: string[];
  cc_list: string[];
  bcc_list: string[];
  subject: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

const cleanList = (list: string[] | undefined) =>
  [...new Set((list ?? []).map((v) => v.trim()).filter(Boolean))].slice(0, MAX_RECIPIENTS).map((v) => v.slice(0, 320));

async function toDtos(ctx: AppContext, rows: DraftRow[]) {
  const ids = rows.map((r) => r.id);
  const atts = ids.length ? await many<AttachmentRow>(ctx.db, 'SELECT * FROM attachments WHERE draft_id = ANY($1::uuid[]) ORDER BY created_at', [ids]) : [];
  const convIds = rows.map((r) => r.conversation_id).filter((v): v is string => !!v);
  const convs = convIds.length
    ? await many<{ id: string; participants: string[] }>(ctx.db, 'SELECT id, participants FROM conversations WHERE id = ANY($1::uuid[])', [convIds])
    : [];
  const info = await describeAddresses(ctx.db, convs.flatMap((c) => c.participants), ctx.config.mailDomain);
  return rows.map((r) => {
    const conv = convs.find((c) => c.id === r.conversation_id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      replyToEntryId: r.reply_to_entry_id,
      fromAddress: r.from_address,
      // Chat drafts always go to the chat's participants.
      to: conv ? conv.participants : r.to_list,
      cc: conv ? [] : r.cc_list,
      bcc: conv ? [] : r.bcc_list,
      participants: conv ? conv.participants.map((p) => info.get(p) ?? { address: p, name: '', phone: null, avatarUrl: null, userId: null, isLocal: false }) : [],
      subject: r.subject,
      body: r.body,
      attachments: atts
        .filter((a) => a.draft_id === r.id)
        .map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size_bytes, inline: false, url: signAttachment(ctx.config, a.id, false) })),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  });
}

export type DraftDto = Awaited<ReturnType<typeof toDtos>>[number];

export async function listDrafts(ctx: AppContext, userId: string): Promise<DraftDto[]> {
  const rows = await many<DraftRow>(ctx.db, 'SELECT * FROM drafts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 500', [userId]);
  return toDtos(ctx, rows);
}

export async function getDraft(ctx: AppContext, userId: string, draftId: string): Promise<DraftDto> {
  const row = await one<DraftRow>(ctx.db, 'SELECT * FROM drafts WHERE id = $1 AND user_id = $2', [draftId, userId]);
  if (!row) throw notFound('Draft not found.');
  const [dto] = await toDtos(ctx, [row]);
  return dto!;
}

/** Creates or updates a draft. A chat has at most one draft, so saving to a chat updates it in place. */
export async function saveDraft(ctx: AppContext, userId: string, draftId: string | null, input: DraftInput): Promise<DraftDto> {
  const subject = singleLine(input.subject ?? '').slice(0, MAX_SUBJECT);
  const body = (input.body ?? '').slice(0, MAX_BODY);
  if (input.conversationId && !(await getConversation(ctx.db, userId, input.conversationId))) throw notFound('Chat not found.');
  if (input.replyToEntryId) {
    const entry = await one(ctx.db, 'SELECT 1 FROM mailbox_entries WHERE id = $1 AND user_id = $2', [input.replyToEntryId, userId]);
    if (!entry) throw notFound('The email you are replying to no longer exists.');
  }

  const id = await withTransaction(ctx.db, async (tx) => {
    const values = [
      input.conversationId ?? null,
      input.replyToEntryId ?? null,
      input.fromAddress?.trim().toLowerCase() || null,
      cleanList(input.to),
      cleanList(input.cc),
      cleanList(input.bcc),
      subject,
      body,
    ];
    let row: { id: string } | undefined;
    if (draftId) {
      row = await one<{ id: string }>(
        tx,
        `UPDATE drafts SET conversation_id = $3, reply_to_entry_id = $4, from_address = $5, to_list = $6, cc_list = $7,
                bcc_list = $8, subject = $9, body = $10, updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING id`,
        [draftId, userId, ...values],
      );
      if (!row) throw notFound('Draft not found.');
    } else {
      try {
        row = await one<{ id: string }>(
          tx,
          `INSERT INTO drafts (user_id, conversation_id, reply_to_entry_id, from_address, to_list, cc_list, bcc_list, subject, body)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL
           DO UPDATE SET reply_to_entry_id = EXCLUDED.reply_to_entry_id, from_address = EXCLUDED.from_address,
                         subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()
           RETURNING id`,
          [userId, ...values],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw unprocessable('draft_conflict', 'This chat already has a draft.');
        throw err;
      }
    }
    const savedId = row!.id;
    if (input.attachmentIds !== undefined) {
      const uploads = await lockUploads(tx, userId, input.attachmentIds, ctx.config.maxAttachmentBytes, savedId);
      await tx.query('UPDATE attachments SET draft_id = NULL WHERE draft_id = $1 AND NOT (id = ANY($2::uuid[]))', [savedId, uploads.map((u) => u.id)]);
      if (uploads.length) await tx.query('UPDATE attachments SET draft_id = $1 WHERE id = ANY($2::uuid[])', [savedId, uploads.map((u) => u.id)]);
    }
    return savedId;
  });
  ctx.realtime.publish(userId, { type: 'drafts.updated' });
  return getDraft(ctx, userId, id);
}

export async function deleteDraft(ctx: AppContext, userId: string, draftId: string): Promise<void> {
  const res = await ctx.db.query('DELETE FROM drafts WHERE id = $1 AND user_id = $2', [draftId, userId]);
  if (!res.rowCount) throw notFound('Draft not found.');
  ctx.realtime.publish(userId, { type: 'drafts.updated' });
}

export async function deleteConversationDraft(ctx: AppContext, userId: string, conversationId: string): Promise<void> {
  const res = await ctx.db.query('DELETE FROM drafts WHERE conversation_id = $1 AND user_id = $2', [conversationId, userId]);
  if (res.rowCount) ctx.realtime.publish(userId, { type: 'drafts.updated' });
}
