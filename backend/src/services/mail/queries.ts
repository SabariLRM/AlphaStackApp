import type { AppContext } from '../../context.js';
import { many, one, type DbClient } from '../../db/pool.js';
import type { Mailbox } from '../../lib/address.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { signAttachment, type AttachmentRow } from './attachments.js';
import { describeAddresses, type ParticipantInfo } from './participants.js';

export type Folder = 'inbox' | 'sent' | 'spam' | 'trash';
export type ListFolder = Folder | 'starred' | 'all';
export type ConversationFilter = 'all' | 'unread' | 'attachments' | 'favorites';

interface EntryRow {
  id: string;
  conversation_id: string;
  email_id: string;
  direction: 'in' | 'out';
  folder: Folder;
  is_read: boolean;
  is_starred: boolean;
  reply_to_entry_id: string | null;
  reply_entry_id: string | null;
  replied_at: Date | null;
  sent_at: Date;
  message_id: string;
  from_address: string;
  from_name: string;
  to_list: Mailbox[];
  cc_list: Mailbox[];
  bcc_list: Mailbox[];
  subject: string;
  snippet: string;
  text_body?: string;
  html_body?: string | null;
  has_attachments: boolean;
}

const SUMMARY_COLUMNS = `me.id, me.conversation_id, me.email_id, me.direction, me.folder, me.is_read, me.is_starred,
  me.reply_to_entry_id, me.reply_entry_id, me.replied_at, me.sent_at, e.message_id, e.from_address, e.from_name,
  e.to_list, e.cc_list, e.bcc_list, e.subject, e.snippet, e.has_attachments`;

export function escapeLike(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  url: string;
}

const toAttachmentDto = (ctx: AppContext, a: AttachmentRow): AttachmentDto => ({
  id: a.id,
  filename: a.filename,
  contentType: a.content_type,
  size: a.size_bytes,
  inline: a.is_inline,
  url: signAttachment(ctx.config, a.id, false),
});

function summaryDto(r: EntryRow) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    folder: r.folder,
    isRead: r.is_read,
    isStarred: r.is_starred,
    sentAt: r.sent_at.toISOString(),
    subject: r.subject,
    snippet: r.snippet,
    from: { address: r.from_address, name: r.from_name },
    to: r.to_list,
    cc: r.cc_list,
    hasAttachments: r.has_attachments,
    repliedAt: r.replied_at?.toISOString() ?? null,
    replyToEntryId: r.reply_to_entry_id,
  };
}

export type MessageSummary = ReturnType<typeof summaryDto>;

export interface ReplyPreview {
  id: string;
  direction: 'in' | 'out';
  subject: string;
  snippet: string;
  from: Mailbox;
  sentAt: string;
}

export interface MessageDetail extends MessageSummary {
  messageId: string;
  text: string;
  html: string | null;
  bcc: Mailbox[];
  attachments: AttachmentDto[];
  replyTo: ReplyPreview | null;
  canReply: boolean;
}

/** Full message payloads for a set of the user's entries, in the order given. */
export async function loadMessages(ctx: AppContext, db: DbClient, userId: string, entryIds: string[]): Promise<MessageDetail[]> {
  if (entryIds.length === 0) return [];
  const rows = await many<EntryRow>(
    db,
    `SELECT ${SUMMARY_COLUMNS}, e.text_body, e.html_body
       FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
      WHERE me.user_id = $1 AND me.id = ANY($2::uuid[])`,
    [userId, entryIds],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const emailIds = [...new Set(rows.map((r) => r.email_id))];
  const attachments = emailIds.length
    ? await many<AttachmentRow>(db, 'SELECT * FROM attachments WHERE email_id = ANY($1::uuid[]) ORDER BY created_at, filename', [emailIds])
    : [];
  const replyIds = [...new Set(rows.map((r) => r.reply_to_entry_id).filter((v): v is string => !!v))];
  const replies = replyIds.length
    ? await many<EntryRow>(
        db,
        `SELECT ${SUMMARY_COLUMNS} FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
          WHERE me.user_id = $1 AND me.id = ANY($2::uuid[])`,
        [userId, replyIds],
      )
    : [];
  const replyById = new Map(replies.map((r) => [r.id, r]));

  const out: MessageDetail[] = [];
  for (const id of entryIds) {
    const r = byId.get(id);
    if (!r) continue;
    const atts = attachments.filter((a) => a.email_id === r.email_id);
    let html = r.html_body ?? null;
    if (html) {
      // Point inline "cid:" images at signed attachment URLs.
      html = html.replace(/(["'])cid:([^"']+)\1/gi, (match, quote: string, cid: string) => {
        const att = atts.find((a) => a.content_id && a.content_id.toLowerCase() === cid.trim().toLowerCase());
        return att ? `${quote}${signAttachment(ctx.config, att.id, true)}${quote}` : match;
      });
    }
    const reply = r.reply_to_entry_id ? replyById.get(r.reply_to_entry_id) : undefined;
    out.push({
      ...summaryDto(r),
      messageId: r.message_id,
      text: r.text_body ?? '',
      html,
      bcc: r.direction === 'out' ? r.bcc_list : [],
      attachments: atts.filter((a) => !a.is_inline || !a.content_id || !html?.includes(a.id)).map((a) => toAttachmentDto(ctx, a)),
      replyTo: reply
        ? {
            id: reply.id,
            direction: reply.direction,
            subject: reply.subject,
            snippet: reply.snippet,
            from: { address: reply.from_address, name: reply.from_name },
            sentAt: reply.sent_at.toISOString(),
          }
        : null,
      canReply: r.replied_at === null && r.folder !== 'trash' && r.folder !== 'spam',
    });
  }
  return out;
}

export async function getMessage(ctx: AppContext, userId: string, entryId: string): Promise<MessageDetail> {
  const [message] = await loadMessages(ctx, ctx.db, userId, [entryId]);
  if (!message) throw notFound('Email not found.');
  return message;
}

const FOLDER_CONDITION: Record<ListFolder, string> = {
  inbox: `me.folder = 'inbox'`,
  sent: `me.folder = 'sent'`,
  spam: `me.folder = 'spam'`,
  trash: `me.folder = 'trash'`,
  starred: `me.is_starred AND me.folder IN ('inbox', 'sent')`,
  all: `me.folder IN ('inbox', 'sent')`,
};

/** Message-level listing used by the Gmail-style web client and the mobile Spam/Trash screens. */
export async function listMessages(
  ctx: AppContext,
  userId: string,
  opts: { folder: ListFolder; q?: string; limit: number; offset: number; unreadOnly?: boolean },
): Promise<{ items: MessageSummary[]; total: number }> {
  const params: unknown[] = [userId];
  let where = `me.user_id = $1 AND ${FOLDER_CONDITION[opts.folder]}`;
  if (opts.unreadOnly) where += ' AND NOT me.is_read';
  if (opts.q?.trim()) {
    params.push(escapeLike(opts.q.trim()));
    const p = `$${params.length}`;
    where += ` AND (e.subject ILIKE ${p} OR e.text_body ILIKE ${p} OR e.from_address ILIKE ${p} OR e.from_name ILIKE ${p}
               OR e.to_list::text ILIKE ${p} OR e.cc_list::text ILIKE ${p})`;
  }
  const total = await one<{ n: number }>(ctx.db, `SELECT count(*)::int AS n FROM mailbox_entries me JOIN emails e ON e.id = me.email_id WHERE ${where}`, params);
  const rows = await many<EntryRow>(
    ctx.db,
    `SELECT ${SUMMARY_COLUMNS} FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
      WHERE ${where} ORDER BY me.sent_at DESC, me.id DESC LIMIT ${Math.trunc(opts.limit)} OFFSET ${Math.trunc(opts.offset)}`,
    params,
  );
  return { items: rows.map(summaryDto), total: total?.n ?? 0 };
}

export async function folderCounts(db: DbClient, userId: string) {
  const row = await one<{ inbox_unread: number; spam_unread: number; drafts: number; starred: number; trash: number }>(
    db,
    `SELECT
       (SELECT count(*)::int FROM mailbox_entries WHERE user_id = $1 AND folder = 'inbox' AND NOT is_read) AS inbox_unread,
       (SELECT count(*)::int FROM mailbox_entries WHERE user_id = $1 AND folder = 'spam' AND NOT is_read) AS spam_unread,
       (SELECT count(*)::int FROM drafts WHERE user_id = $1) AS drafts,
       (SELECT count(*)::int FROM mailbox_entries WHERE user_id = $1 AND is_starred AND folder IN ('inbox', 'sent')) AS starred,
       (SELECT count(*)::int FROM mailbox_entries WHERE user_id = $1 AND folder = 'trash') AS trash`,
    [userId],
  );
  return { inboxUnread: row?.inbox_unread ?? 0, spamUnread: row?.spam_unread ?? 0, drafts: row?.drafts ?? 0, starred: row?.starred ?? 0, trash: row?.trash ?? 0 };
}

interface ConversationListRow {
  id: string;
  participants: string[];
  is_group: boolean;
  is_favorite: boolean;
  unread_count: number;
  entry_id: string | null;
  direction: 'in' | 'out' | null;
  sent_at: Date | null;
  subject: string | null;
  snippet: string | null;
  has_attachments: boolean | null;
  from_address: string | null;
  from_name: string | null;
  draft_id: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_updated_at: Date | null;
  activity: Date;
}

export interface ConversationDto {
  id: string;
  isGroup: boolean;
  isSelf: boolean;
  isFavorite: boolean;
  participants: ParticipantInfo[];
  unreadCount: number;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    direction: 'in' | 'out';
    subject: string;
    snippet: string;
    sentAt: string;
    hasAttachments: boolean;
    from: Mailbox;
  } | null;
  draft: { id: string; subject: string; body: string; updatedAt: string } | null;
}

const CONVERSATION_SELECT = `
  SELECT c.id, c.participants, c.is_group, c.is_favorite,
         (SELECT count(*)::int FROM mailbox_entries u WHERE u.conversation_id = c.id AND u.folder = 'inbox' AND NOT u.is_read) AS unread_count,
         last.entry_id, last.direction, last.sent_at, last.subject, last.snippet, last.has_attachments, last.from_address, last.from_name,
         d.id AS draft_id, d.subject AS draft_subject, d.body AS draft_body, d.updated_at AS draft_updated_at,
         COALESCE(last.sent_at, d.updated_at, c.created_at) AS activity
    FROM conversations c
    LEFT JOIN LATERAL (
      SELECT me.id AS entry_id, me.direction, me.sent_at, e.subject, e.snippet, e.has_attachments, e.from_address, e.from_name
        FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
       WHERE me.conversation_id = c.id AND me.folder IN ('inbox', 'sent')
       ORDER BY me.sent_at DESC, me.created_at DESC LIMIT 1
    ) last ON true
    LEFT JOIN drafts d ON d.conversation_id = c.id`;

async function toConversationDtos(ctx: AppContext, db: DbClient, userAddress: string, rows: ConversationListRow[]): Promise<ConversationDto[]> {
  const info = await describeAddresses(db, rows.flatMap((r) => r.participants), ctx.config.mailDomain);
  return rows.map((r) => ({
    id: r.id,
    isGroup: r.is_group,
    isSelf: r.participants.length === 1 && r.participants[0] === userAddress,
    isFavorite: r.is_favorite,
    participants: r.participants.map(
      (p) => info.get(p) ?? { address: p, name: '', phone: null, avatarUrl: null, userId: null, isLocal: p.endsWith(`@${ctx.config.mailDomain}`) },
    ),
    unreadCount: r.unread_count,
    lastActivityAt: r.activity.toISOString(),
    lastMessage:
      r.entry_id && r.direction && r.sent_at
        ? {
            id: r.entry_id,
            direction: r.direction,
            subject: r.subject ?? '',
            snippet: r.snippet ?? '',
            sentAt: r.sent_at.toISOString(),
            hasAttachments: !!r.has_attachments,
            from: { address: r.from_address ?? '', name: r.from_name ?? '' },
          }
        : null,
    draft:
      r.draft_id && r.draft_updated_at
        ? { id: r.draft_id, subject: r.draft_subject ?? '', body: r.draft_body ?? '', updatedAt: r.draft_updated_at.toISOString() }
        : null,
  }));
}

export async function listConversations(
  ctx: AppContext,
  user: { id: string; address: string },
  opts: { filter: ConversationFilter; q?: string; limit: number; offset: number },
): Promise<ConversationDto[]> {
  const params: unknown[] = [user.id];
  const conditions = ['(x.entry_id IS NOT NULL OR x.draft_id IS NOT NULL)'];
  if (opts.filter === 'unread') conditions.push('x.unread_count > 0');
  if (opts.filter === 'favorites') conditions.push('x.is_favorite');
  if (opts.filter === 'attachments') {
    conditions.push(`EXISTS (SELECT 1 FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
                     WHERE me.conversation_id = x.id AND me.folder IN ('inbox', 'sent') AND e.has_attachments)`);
  }
  if (opts.q?.trim()) {
    const raw = opts.q.trim();
    params.push(escapeLike(raw));
    const p = `$${params.length}`;
    const digits = raw.replace(/\D/g, '');
    let phoneCondition = '';
    if (digits.length >= 3) {
      params.push(escapeLike(digits));
      phoneCondition = ` OR u.phone LIKE $${params.length}`;
    }
    conditions.push(`(
      array_to_string(x.participants, ' ') ILIKE ${p}
      OR EXISTS (SELECT 1 FROM users u WHERE u.address = ANY(x.participants) AND (u.display_name ILIKE ${p}${phoneCondition}))
      OR EXISTS (SELECT 1 FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
                  WHERE me.conversation_id = x.id AND me.folder IN ('inbox', 'sent')
                    AND (e.subject ILIKE ${p} OR e.text_body ILIKE ${p} OR e.from_name ILIKE ${p})))`);
  }
  const rows = await many<ConversationListRow>(
    ctx.db,
    `SELECT * FROM (${CONVERSATION_SELECT} WHERE c.user_id = $1) x
      WHERE ${conditions.join(' AND ')}
      ORDER BY x.activity DESC, x.id LIMIT ${Math.trunc(opts.limit)} OFFSET ${Math.trunc(opts.offset)}`,
    params,
  );
  return toConversationDtos(ctx, ctx.db, user.address, rows);
}

export async function getConversationDto(ctx: AppContext, user: { id: string; address: string }, conversationId: string): Promise<ConversationDto> {
  const rows = await many<ConversationListRow>(ctx.db, `${CONVERSATION_SELECT} WHERE c.user_id = $1 AND c.id = $2`, [user.id, conversationId]);
  if (!rows.length) throw notFound('Chat not found.');
  const [dto] = await toConversationDtos(ctx, ctx.db, user.address, rows);
  return dto!;
}

export function parseCursor(cursor: string | undefined): { sentAt: Date; id: string } | null {
  if (!cursor) return null;
  const [ts, id] = cursor.split('|');
  const sentAt = new Date(ts ?? '');
  if (!id || Number.isNaN(sentAt.getTime())) throw badRequest('invalid_cursor', 'Invalid cursor.');
  return { sentAt, id };
}

/** Chat messages, newest first, with keyset pagination. */
export async function listConversationMessages(
  ctx: AppContext,
  userId: string,
  conversationId: string,
  opts: { before?: string; limit: number },
): Promise<{ items: MessageDetail[]; nextCursor: string | null }> {
  const cursor = parseCursor(opts.before);
  const params: unknown[] = [userId, conversationId];
  let where = `me.user_id = $1 AND me.conversation_id = $2 AND me.folder IN ('inbox', 'sent')`;
  if (cursor) {
    params.push(cursor.sentAt, cursor.id);
    where += ` AND (me.sent_at, me.id) < ($3, $4::uuid)`;
  }
  const ids = await many<{ id: string; sent_at: Date }>(
    ctx.db,
    `SELECT me.id, me.sent_at FROM mailbox_entries me WHERE ${where} ORDER BY me.sent_at DESC, me.id DESC LIMIT ${Math.trunc(opts.limit) + 1}`,
    params,
  );
  const hasMore = ids.length > opts.limit;
  const page = ids.slice(0, opts.limit);
  const items = await loadMessages(ctx, ctx.db, userId, page.map((r) => r.id));
  const last = page[page.length - 1];
  return { items, nextCursor: hasMore && last ? `${last.sent_at.toISOString()}|${last.id}` : null };
}
