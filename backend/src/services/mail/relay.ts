import nodemailer, { type Transporter } from 'nodemailer';
import type { AppContext } from '../../context.js';
import { many, one } from '../../db/pool.js';
import { formatMailbox, type Mailbox } from '../../lib/address.js';
import type { AttachmentRow } from './attachments.js';

let transport: Transporter | null = null;
let transportUrl = '';

function getTransport(url: string): Transporter {
  if (!transport || transportUrl !== url) {
    transport = nodemailer.createTransport(url);
    transportUrl = url;
  }
  return transport;
}

/** "mail.relay" job: hands mail for non-PhoneMail recipients to the configured SMTP relay. */
export async function handleRelayJob(ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  if (!ctx.config.smtpRelayUrl) throw new Error('SMTP relay is not configured');
  const emailId = String(payload.emailId ?? '');
  const recipients = Array.isArray(payload.recipients) ? payload.recipients.map(String) : [];
  if (!recipients.length) return;

  const email = await one<{
    message_id: string;
    in_reply_to: string | null;
    references_header: string[];
    from_address: string;
    from_name: string;
    to_list: Mailbox[];
    cc_list: Mailbox[];
    subject: string;
    text_body: string;
    html_body: string | null;
    sent_at: Date;
  }>(ctx.db, 'SELECT * FROM emails WHERE id = $1', [emailId]);
  if (!email) return; // deleted before it could be relayed
  const attachments = await many<AttachmentRow>(ctx.db, 'SELECT * FROM attachments WHERE email_id = $1 ORDER BY created_at', [emailId]);

  await getTransport(ctx.config.smtpRelayUrl).sendMail({
    from: formatMailbox({ address: email.from_address, name: email.from_name }),
    to: email.to_list.map(formatMailbox),
    cc: email.cc_list.length ? email.cc_list.map(formatMailbox) : undefined,
    subject: email.subject,
    text: email.text_body,
    html: email.html_body ?? undefined,
    messageId: email.message_id,
    inReplyTo: email.in_reply_to ?? undefined,
    references: email.references_header.length ? email.references_header : undefined,
    date: email.sent_at,
    envelope: { from: email.from_address, to: recipients },
    attachments: attachments.map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
      content: ctx.storage.open(a.storage_key),
      cid: a.content_id ?? undefined,
    })),
  });
  ctx.log.info({ emailId, recipients: recipients.length }, 'relayed external mail');
}
