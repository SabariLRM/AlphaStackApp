import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTransaction } from '../../db/pool.js';
import { domainOf, normalizeAddress, type Mailbox } from '../../lib/address.js';
import { AppError, payloadTooLarge, unprocessable } from '../../lib/errors.js';
import { htmlToPlainText, makeSnippet, sanitizeEmailHtml, singleLine } from '../../lib/html.js';
import { resolveLocalAddress, type UserRow } from '../users.js';
import { sanitizeContentType, sanitizeFilename } from './attachments.js';
import { fileIncoming, insertEmail, publishFiled, type EmailInput, type FiledEntry } from './delivery.js';

const mailboxSchema = z.object({ name: z.string().max(500).optional().default(''), address: z.string().max(320) });

export const inboundSchema = z.object({
  envelope: z.object({
    mailFrom: z.string().max(320).default(''),
    rcptTo: z.array(z.string().max(320)).min(1).max(100),
    remoteAddr: z.string().max(100).optional(),
    helo: z.string().max(255).optional(),
  }),
  message: z.object({
    messageId: z.string().max(998).optional(),
    inReplyTo: z.string().max(998).optional(),
    references: z.array(z.string().max(998)).max(100).optional().default([]),
    from: mailboxSchema.optional(),
    to: z.array(mailboxSchema).max(500).optional().default([]),
    cc: z.array(mailboxSchema).max(500).optional().default([]),
    subject: z.string().max(10_000).optional().default(''),
    date: z.string().max(100).optional(),
    text: z.string().optional().default(''),
    html: z.string().optional().default(''),
    size: z.number().int().nonnegative().optional().default(0),
    attachments: z
      .array(
        z.object({
          filename: z.string().max(1000).optional().default(''),
          contentType: z.string().max(255).optional().default('application/octet-stream'),
          contentId: z.string().max(998).optional(),
          inline: z.boolean().optional().default(false),
          data: z.string(),
        }),
      )
      .max(100)
      .optional()
      .default([]),
  }),
});

export type InboundPayload = z.infer<typeof inboundSchema>;

const angle = (id: string) => {
  const trimmed = id.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
};

function toMailboxes(list: { name: string; address: string }[]): Mailbox[] {
  const out: Mailbox[] = [];
  for (const m of list) {
    const address = normalizeAddress(m.address);
    if (address && !out.some((o) => o.address === address)) out.push({ address, name: singleLine(m.name).slice(0, 200) });
  }
  return out;
}

/** Validates a recipient during the SMTP RCPT stage. */
export async function checkRecipient(ctx: AppContext, raw: string): Promise<UserRow | undefined> {
  const address = normalizeAddress(raw);
  if (!address || domainOf(address) !== ctx.config.mailDomain) return undefined;
  return resolveLocalAddress(ctx.db, address);
}

/** Stores a message received by the SMTP server and files it into every local recipient's mailbox. */
export async function deliverInbound(ctx: AppContext, payload: InboundPayload): Promise<{ delivered: number }> {
  const { config, db, storage } = ctx;
  const { envelope, message } = payload;

  const recipients = new Map<string, UserRow>();
  for (const rcpt of envelope.rcptTo) {
    const user = await checkRecipient(ctx, rcpt);
    if (user) recipients.set(user.id, user);
  }
  if (recipients.size === 0) throw unprocessable('no_recipients', 'None of the recipients exist on this server.');

  const fromAddress = normalizeAddress(message.from?.address ?? '') ?? normalizeAddress(envelope.mailFrom);
  if (!fromAddress) throw unprocessable('invalid_sender', 'The message has no valid sender address.');
  // Local users only send through the API; SMTP mail claiming a local sender is spoofed.
  if (domainOf(fromAddress) === config.mailDomain) throw new AppError(403, 'spoofed_sender', 'Local senders must be authenticated.');

  let html: string | null = message.html ? sanitizeEmailHtml(message.html) : null;
  if (html !== null && !html.trim()) html = null;
  let text = message.text.replace(/\r\n/g, '\n');
  if (!text.trim() && html) text = htmlToPlainText(html);

  let sentAt = message.date ? new Date(message.date) : new Date();
  if (Number.isNaN(sentAt.getTime()) || sentAt.getTime() > Date.now() + 24 * 3600_000) sentAt = new Date();

  // Persist attachment files first; they are removed again if the transaction fails.
  const stored: { key: string; filename: string; contentType: string; size: number; contentId: string | null; inline: boolean }[] = [];
  let totalBytes = 0;
  try {
    for (const att of message.attachments) {
      const data = Buffer.from(att.data, 'base64');
      totalBytes += data.length;
      if (totalBytes > config.maxAttachmentBytes * 2) throw payloadTooLarge('Message attachments are too large.');
      const key = await storage.saveBuffer('attachments', data);
      stored.push({
        key,
        filename: sanitizeFilename(att.filename || (att.inline ? 'inline' : 'attachment')),
        contentType: sanitizeContentType(att.contentType),
        size: data.length,
        contentId: att.contentId ? att.contentId.replace(/^<|>$/g, '').slice(0, 500) : null,
        inline: att.inline,
      });
    }

    const email: EmailInput = {
      messageId: angle(message.messageId ?? '') || `<${randomUUID()}@${config.mailDomain}>`,
      inReplyTo: message.inReplyTo ? angle(message.inReplyTo.split(/\s+/)[0] ?? '') || null : null,
      references: message.references.map(angle).filter(Boolean).slice(-20),
      from: { address: fromAddress, name: singleLine(message.from?.name ?? '').slice(0, 200) },
      to: toMailboxes(message.to),
      cc: toMailboxes(message.cc),
      bcc: [],
      subject: singleLine(message.subject).slice(0, 998),
      text,
      html,
      snippet: makeSnippet(text),
      sentAt,
      origin: 'smtp',
      sizeBytes: message.size || Buffer.byteLength(text) + totalBytes,
      hasAttachments: stored.some((s) => !s.inline),
    };

    const filed = await withTransaction(db, async (tx) => {
      const emailId = await insertEmail(tx, email);
      for (const s of stored) {
        await tx.query(
          `INSERT INTO attachments (email_id, filename, content_type, size_bytes, content_id, is_inline, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [emailId, s.filename, s.contentType, s.size, s.contentId, s.inline, s.key],
        );
      }
      const out: FiledEntry[] = [];
      for (const user of recipients.values()) out.push(await fileIncoming(tx, emailId, email, user));
      return out;
    });
    publishFiled(ctx, filed);
    ctx.log.info({ from: fromAddress, recipients: recipients.size, remote: envelope.remoteAddr }, 'inbound mail delivered');
    return { delivered: filed.length };
  } catch (err) {
    await Promise.all(stored.map((s) => storage.remove(s.key).catch(() => undefined)));
    throw err;
  }
}
