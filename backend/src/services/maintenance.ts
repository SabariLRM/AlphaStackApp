import type { AppContext } from '../context.js';
import { many } from '../db/pool.js';

/** Periodic cleanup: expired auth data, old trash, orphaned emails and upload files. */
export async function runMaintenance(ctx: AppContext): Promise<void> {
  const { db, storage, config, log } = ctx;
  await db.query(`DELETE FROM otp_challenges WHERE created_at < now() - interval '2 days'`);
  await db.query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM sms_log WHERE created_at < now() - interval '30 days'`);
  if (config.trashRetentionDays > 0) {
    await db.query(`DELETE FROM mailbox_entries WHERE folder = 'trash' AND trashed_at < now() - make_interval(days => $1)`, [config.trashRetentionDays]);
  }
  // Emails nobody holds a copy of any more.
  await db.query(
    `DELETE FROM emails e WHERE e.created_at < now() - interval '5 minutes'
       AND NOT EXISTS (SELECT 1 FROM mailbox_entries me WHERE me.email_id = e.id)`,
  );
  // Attachment files no email or draft references (abandoned uploads or deleted mail).
  const orphans = await many<{ storage_key: string }>(
    db,
    `DELETE FROM attachments WHERE email_id IS NULL AND draft_id IS NULL AND created_at < now() - interval '1 day' RETURNING storage_key`,
  );
  for (const o of orphans) await storage.remove(o.storage_key).catch(() => undefined);
  // Conversations left without any mail or draft.
  await db.query(
    `DELETE FROM conversations c WHERE c.created_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM mailbox_entries me WHERE me.conversation_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.conversation_id = c.id)`,
  );
  if (orphans.length) log.info({ files: orphans.length }, 'maintenance removed orphaned attachments');
}
