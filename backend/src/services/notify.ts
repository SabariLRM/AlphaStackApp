import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { getUserById, hasActiveMobileApp } from './users.js';

export function notificationText(sender: { address: string; name: string }, subject: string): string {
  const who = sender.name ? `${sender.name} (${sender.address})` : sender.address;
  const subj = subject.trim() || '(no subject)';
  const shortSubject = subj.length > 80 ? `${subj.slice(0, 79)}…` : subj;
  return `You have received an email from ${who}. Subject: ${shortSubject}.`;
}

/**
 * "sms.notify" job: texts users who do not use the mobile app (they registered by phone call, SMS,
 * the portal or the web client and have no active app session) when an email arrives.
 */
export async function handleNotifyJob(ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  const userId = String(payload.userId ?? '');
  const entryId = String(payload.entryId ?? '');
  const user = await getUserById(ctx.db, userId);
  if (!user || !user.sms_notifications) return;
  if (await hasActiveMobileApp(ctx, user.id)) {
    ctx.log.debug({ userId }, 'skip sms notification: user has the mobile app');
    return;
  }
  const entry = await one<{ folder: string; is_read: boolean; from_address: string; from_name: string; subject: string }>(
    ctx.db,
    `SELECT me.folder, me.is_read, e.from_address, e.from_name, e.subject
       FROM mailbox_entries me JOIN emails e ON e.id = me.email_id WHERE me.id = $1 AND me.user_id = $2`,
    [entryId, userId],
  );
  if (!entry || entry.folder !== 'inbox' || entry.is_read) return;

  const recent = await one<{ n: number }>(
    ctx.db,
    `SELECT count(*)::int AS n FROM sms_log WHERE user_id = $1 AND purpose = 'notification' AND status = 'sent' AND created_at > now() - interval '1 hour'`,
    [userId],
  );
  if ((recent?.n ?? 0) >= ctx.config.sms.notifyMaxPerHour) {
    ctx.log.warn({ userId }, 'skip sms notification: hourly limit reached');
    return;
  }
  await ctx.sms.send({
    to: user.phone,
    body: notificationText({ address: entry.from_address, name: entry.from_name }, entry.subject),
    purpose: 'notification',
    userId,
  });
}

/** "sms.send" job: fire-and-forget texts such as the welcome message. */
export async function handleSmsSendJob(ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  const purpose = payload.purpose === 'notification' ? 'notification' : 'welcome';
  await ctx.sms.send({
    to: String(payload.to ?? ''),
    body: String(payload.body ?? ''),
    purpose,
    userId: typeof payload.userId === 'string' ? payload.userId : null,
  });
}

export function welcomeText(ctx: AppContext, address: string): string {
  return `Welcome to PhoneMail! Your email address is ${address}. Sign in with your phone number at ${ctx.config.publicWebUrl}`;
}
