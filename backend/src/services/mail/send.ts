import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../context.js';
import { one, withTransaction, type DbClient } from '../../db/pool.js';
import { domainOf, normalizeAddress, type Mailbox } from '../../lib/address.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { makeSnippet, replySubject, singleLine } from '../../lib/html.js';
import { looksLikePhone, normalizePhone } from '../../lib/phone.js';
import { enqueueJob } from '../jobs.js';
import { getUserAddresses, getUserById, getUserByPhone, resolveLocalAddress, type UserRow } from '../users.js';
import { lockUploads } from './attachments.js';
import { fileIncoming, fileOutgoing, insertEmail, publishFiled, type EmailInput, type FiledEntry } from './delivery.js';
import { getConversation } from './participants.js';

export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT = 500;
export const MAX_BODY = 500_000;

export interface SendInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  fromAddress?: string;
  replyToEntryId?: string;
  attachmentIds?: string[];
  draftId?: string;
  /** Sending inside a chat: recipients are the chat's participants and cannot be changed. */
  conversationId?: string;
}

export interface SendResult {
  entryId: string;
  conversationId: string;
  emailId: string;
}

interface ResolvedRecipient {
  address: string;
  user?: UserRow;
}

export async function resolveRecipient(ctx: AppContext, db: DbClient, raw: string): Promise<ResolvedRecipient> {
  const value = raw.trim();
  if (!value) throw unprocessable('invalid_recipient', 'Recipient is empty.');
  if (value.includes('@')) {
    const address = normalizeAddress(value);
    if (!address) throw unprocessable('invalid_recipient', `"${value}" is not a valid email address.`, { recipient: value });
    if (domainOf(address) === ctx.config.mailDomain) {
      const user = await resolveLocalAddress(db, address);
      if (!user) throw unprocessable('unknown_recipient', `There is no PhoneMail account for ${address}.`, { recipient: value });
      return { address, user };
    }
    if (!ctx.config.smtpRelayUrl) {
      throw unprocessable('external_disabled', `Sending to external addresses (${address}) is not enabled on this server.`, { recipient: value });
    }
    return { address };
  }
  if (looksLikePhone(value)) {
    const phone = normalizePhone(value, ctx.config.defaultCountry);
    const user = phone ? await getUserByPhone(db, phone.e164) : undefined;
    if (!user) throw unprocessable('unknown_recipient', `${value} is not on PhoneMail yet.`, { recipient: value });
    return { address: user.address, user };
  }
  throw unprocessable('invalid_recipient', `"${value}" is not a valid email address or phone number.`, { recipient: value });
}

async function resolveList(ctx: AppContext, db: DbClient, list: string[] | undefined): Promise<ResolvedRecipient[]> {
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const r = await resolveRecipient(ctx, db, raw);
    if (seen.has(r.address)) continue;
    seen.add(r.address);
    out.push(r);
  }
  return out;
}

const mailboxesFor = (recipients: ResolvedRecipient[]): Mailbox[] => recipients.map((r) => ({ address: r.address, name: r.user?.display_name ?? '' }));

export async function sendEmail(ctx: AppContext, senderId: string, input: SendInput): Promise<SendResult> {
  const { db, config } = ctx;
  const sender = await getUserById(db, senderId);
  if (!sender) throw notFound('Account not found.');

  const subjectInput = singleLine(input.subject ?? '');
  const body = (input.body ?? '').replace(/\r\n/g, '\n');
  if (subjectInput.length > MAX_SUBJECT) throw unprocessable('subject_too_long', `Subject must be at most ${MAX_SUBJECT} characters.`);
  if (body.length > MAX_BODY) throw unprocessable('body_too_long', 'The message is too long.');

  const ownAddresses = (await getUserAddresses(db, sender.id)).map((a) => a.address);
  let fromAddress = sender.address;
  if (input.fromAddress) {
    const wanted = input.fromAddress.trim().toLowerCase();
    if (!ownAddresses.includes(wanted)) throw unprocessable('invalid_from', 'You can only send from your own addresses.');
    fromAddress = wanted;
  }

  let to: ResolvedRecipient[];
  let cc: ResolvedRecipient[] = [];
  let bcc: ResolvedRecipient[] = [];
  if (input.conversationId) {
    const conversation = await getConversation(db, sender.id, input.conversationId);
    if (!conversation) throw notFound('Chat not found.');
    to = await resolveList(ctx, db, conversation.participants);
  } else {
    to = await resolveList(ctx, db, input.to);
    cc = (await resolveList(ctx, db, input.cc)).filter((r) => !to.some((t) => t.address === r.address));
    bcc = (await resolveList(ctx, db, input.bcc)).filter((r) => !to.some((t) => t.address === r.address) && !cc.some((c) => c.address === r.address));
  }
  if (to.length + cc.length + bcc.length === 0) throw unprocessable('no_recipients', 'Add at least one recipient.');
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw unprocessable('too_many_recipients', `At most ${MAX_RECIPIENTS} recipients per email.`);

  const attachmentIds = input.attachmentIds ?? [];
  if (!subjectInput && !body.trim() && attachmentIds.length === 0 && !input.replyToEntryId) {
    throw unprocessable('empty_message', 'Write a subject or a message before sending.');
  }

  const result = await withTransaction(db, async (tx) => {
    let subject = subjectInput;
    let inReplyTo: string | null = null;
    let references: string[] = [];
    let replyToEntryId: string | null = null;

    if (input.replyToEntryId) {
      const original = await one<{ id: string; replied_at: Date | null; folder: string; message_id: string; subject: string; references_header: string[] }>(
        tx,
        `SELECT me.id, me.replied_at, me.folder, e.message_id, e.subject, e.references_header
           FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
          WHERE me.id = $1 AND me.user_id = $2 FOR UPDATE OF me`,
        [input.replyToEntryId, sender.id],
      );
      if (!original) throw notFound('The email you are replying to no longer exists.');
      if (original.replied_at) throw conflict('already_replied', 'You have already replied to this email. Each email can be replied to only once.');
      replyToEntryId = original.id;
      inReplyTo = original.message_id;
      references = [...original.references_header, original.message_id].slice(-20);
      if (!subject) subject = replySubject(original.subject);
    }

    const uploads = await lockUploads(tx, sender.id, attachmentIds, config.maxAttachmentBytes, input.draftId ?? null);
    const email: EmailInput = {
      messageId: `<${randomUUID()}@${config.mailDomain}>`,
      inReplyTo,
      references,
      from: { address: fromAddress, name: sender.display_name },
      to: mailboxesFor(to),
      cc: mailboxesFor(cc),
      bcc: mailboxesFor(bcc),
      subject,
      text: body,
      html: null,
      snippet: makeSnippet(body) || (uploads.length ? uploads.map((u) => u.filename).join(', ') : ''),
      sentAt: new Date(),
      origin: 'local',
      sizeBytes: Buffer.byteLength(body) + uploads.reduce((s, u) => s + u.size_bytes, 0),
      hasAttachments: uploads.length > 0,
    };
    const emailId = await insertEmail(tx, email);
    if (uploads.length) {
      await tx.query('UPDATE attachments SET email_id = $1, draft_id = NULL WHERE id = ANY($2::uuid[])', [emailId, uploads.map((u) => u.id)]);
    }

    const filed: FiledEntry[] = [];
    const sent = await fileOutgoing(tx, emailId, email, sender, replyToEntryId);
    filed.push(sent);
    if (replyToEntryId) {
      await tx.query('UPDATE mailbox_entries SET replied_at = now(), reply_entry_id = $2 WHERE id = $1', [replyToEntryId, sent.entryId]);
    }

    // Local delivery. Mail to yourself only needs the Sent copy.
    const all = [...to, ...cc, ...bcc];
    const localUsers = new Map<string, UserRow>();
    for (const r of all) if (r.user && r.user.id !== sender.id) localUsers.set(r.user.id, r.user);
    for (const user of localUsers.values()) filed.push(await fileIncoming(tx, emailId, email, user));

    const external = all.filter((r) => !r.user).map((r) => r.address);
    if (external.length) await enqueueJob(tx, 'mail.relay', { emailId, recipients: external }, { maxAttempts: 6 });

    if (input.draftId) await tx.query('DELETE FROM drafts WHERE id = $1 AND user_id = $2', [input.draftId, sender.id]);
    // Sending from a chat clears that chat's composer draft.
    await tx.query('DELETE FROM drafts WHERE conversation_id = $1 AND user_id = $2', [sent.conversationId, sender.id]);

    return { filed, sent, emailId };
  });

  publishFiled(ctx, result.filed);
  if (input.replyToEntryId) ctx.realtime.publish(sender.id, { type: 'entries.updated', entryIds: [input.replyToEntryId], conversationIds: [result.sent.conversationId] });
  ctx.realtime.publish(sender.id, { type: 'drafts.updated' });
  return { entryId: result.sent.entryId, conversationId: result.sent.conversationId, emailId: result.emailId };
}
