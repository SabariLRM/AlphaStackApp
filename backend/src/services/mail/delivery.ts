import type { AppContext } from '../../context.js';
import { one, type DbClient } from '../../db/pool.js';
import type { Mailbox } from '../../lib/address.js';
import { enqueueJob } from '../jobs.js';
import type { RealtimeEvent } from '../realtime.js';
import type { UserRow } from '../users.js';
import { getOrCreateConversation, participantsFor } from './participants.js';

export interface EmailInput {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  bcc: Mailbox[];
  subject: string;
  text: string;
  html: string | null;
  snippet: string;
  sentAt: Date;
  origin: 'local' | 'smtp';
  sizeBytes: number;
  hasAttachments: boolean;
}

export interface FiledEntry {
  userId: string;
  entryId: string;
  conversationId: string;
  folder: 'inbox' | 'sent' | 'spam';
  direction: 'in' | 'out';
}

export async function insertEmail(tx: DbClient, input: EmailInput): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `INSERT INTO emails (message_id, in_reply_to, references_header, from_address, from_name, to_list, cc_list, bcc_list,
                         subject, text_body, html_body, snippet, has_attachments, size_bytes, origin, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [
      input.messageId,
      input.inReplyTo,
      input.references,
      input.from.address,
      input.from.name,
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      JSON.stringify(input.bcc),
      input.subject,
      input.text,
      input.html,
      input.snippet,
      input.hasAttachments,
      input.sizeBytes,
      input.origin,
      input.sentAt,
    ],
  );
  return row!.id;
}

/** The user's copy of the email that `inReplyTo` refers to, if they have one. */
async function findReplyTarget(tx: DbClient, userId: string, inReplyTo: string | null): Promise<string | null> {
  if (!inReplyTo) return null;
  const row = await one<{ id: string }>(
    tx,
    `SELECT me.id FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
      WHERE me.user_id = $1 AND e.message_id = $2 ORDER BY me.created_at LIMIT 1`,
    [userId, inReplyTo],
  );
  return row?.id ?? null;
}

async function insertEntry(
  tx: DbClient,
  e: {
    userId: string;
    emailId: string;
    conversationId: string;
    direction: 'in' | 'out';
    folder: 'inbox' | 'sent' | 'spam';
    isRead: boolean;
    replyToEntryId: string | null;
    sentAt: Date;
  },
): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `INSERT INTO mailbox_entries (user_id, email_id, conversation_id, direction, folder, is_read, reply_to_entry_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [e.userId, e.emailId, e.conversationId, e.direction, e.folder, e.isRead, e.replyToEntryId, e.sentAt],
  );
  await tx.query('UPDATE conversations SET last_activity_at = GREATEST(last_activity_at, $2) WHERE id = $1', [e.conversationId, e.sentAt]);
  return row!.id;
}

/** Files a received email into a recipient's mailbox (Inbox, or Spam for blocked senders). */
export async function fileIncoming(tx: DbClient, emailId: string, email: EmailInput, recipient: UserRow): Promise<FiledEntry> {
  const blocked = await one(tx, 'SELECT 1 FROM spam_senders WHERE user_id = $1 AND address = $2', [recipient.id, email.from.address]);
  const folder = blocked ? 'spam' : 'inbox';
  const participants = await participantsFor(tx, recipient, [email.from.address, ...email.to.map((m) => m.address), ...email.cc.map((m) => m.address)]);
  const conversation = await getOrCreateConversation(tx, recipient.id, participants);
  const replyToEntryId = await findReplyTarget(tx, recipient.id, email.inReplyTo);
  const entryId = await insertEntry(tx, {
    userId: recipient.id,
    emailId,
    conversationId: conversation.id,
    direction: 'in',
    folder,
    isRead: false,
    replyToEntryId,
    sentAt: email.sentAt,
  });
  if (folder === 'inbox' && recipient.sms_notifications) {
    // The job decides at run time whether the user has the app (and therefore needs no SMS).
    await enqueueJob(tx, 'sms.notify', { userId: recipient.id, entryId }, { maxAttempts: 3 });
  }
  return { userId: recipient.id, entryId, conversationId: conversation.id, folder, direction: 'in' };
}

/** Files the sender's own copy into Sent, in the chat made of the visible recipients. */
export async function fileOutgoing(
  tx: DbClient,
  emailId: string,
  email: EmailInput,
  sender: UserRow,
  replyToEntryId: string | null,
): Promise<FiledEntry> {
  let visible = [...email.to, ...email.cc].map((m) => m.address);
  if (visible.length === 0) visible = email.bcc.map((m) => m.address);
  const participants = await participantsFor(tx, sender, visible);
  const conversation = await getOrCreateConversation(tx, sender.id, participants);
  const entryId = await insertEntry(tx, {
    userId: sender.id,
    emailId,
    conversationId: conversation.id,
    direction: 'out',
    folder: 'sent',
    isRead: true,
    replyToEntryId,
    sentAt: email.sentAt,
  });
  return { userId: sender.id, entryId, conversationId: conversation.id, folder: 'sent', direction: 'out' };
}

export function publishFiled(ctx: AppContext, filed: FiledEntry[]): void {
  for (const f of filed) {
    const event: RealtimeEvent = { type: 'entry.created', entryId: f.entryId, conversationId: f.conversationId, folder: f.folder, direction: f.direction };
    ctx.realtime.publish(f.userId, event);
  }
}
