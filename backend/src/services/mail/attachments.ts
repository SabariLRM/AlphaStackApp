import type { Config } from '../../config.js';
import { many, type DbClient } from '../../db/pool.js';
import { hmacHex, safeEqual } from '../../lib/crypto.js';
import { payloadTooLarge, unprocessable } from '../../lib/errors.js';

export interface AttachmentRow {
  id: string;
  owner_id: string | null;
  email_id: string | null;
  draft_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_id: string | null;
  is_inline: boolean;
  storage_key: string;
  created_at: Date;
}

export const MAX_ATTACHMENTS_PER_EMAIL = 20;

export function sanitizeFilename(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim().slice(0, 200);
  return clean && clean !== '.' && clean !== '..' ? clean : 'attachment';
}

export function sanitizeContentType(value: string | undefined): string {
  const v = (value ?? '').split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(v) ? v : 'application/octet-stream';
}

/** Locks the user's unsent uploads so they can be attached to a new email or draft. */
export async function lockUploads(tx: DbClient, userId: string, ids: string[], maxTotalBytes: number, draftId: string | null): Promise<AttachmentRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  if (unique.length > MAX_ATTACHMENTS_PER_EMAIL) throw unprocessable('too_many_attachments', `At most ${MAX_ATTACHMENTS_PER_EMAIL} attachments per email.`);
  const rows = await many<AttachmentRow>(
    tx,
    `SELECT * FROM attachments WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND email_id IS NULL
        AND (draft_id IS NULL OR draft_id = $3::uuid)
      ORDER BY created_at FOR UPDATE`,
    [unique, userId, draftId],
  );
  if (rows.length !== unique.length) throw unprocessable('invalid_attachment', 'One of the attachments is missing or was already sent. Please attach it again.');
  const total = rows.reduce((sum, r) => sum + r.size_bytes, 0);
  if (total > maxTotalBytes) throw payloadTooLarge(`Attachments exceed the ${Math.floor(maxTotalBytes / 1024 / 1024)} MB limit.`);
  return rows;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const SIGNED_URL_TTL_SECONDS = 6 * 3600;

export function signAttachment(config: Config, id: string, inline: boolean, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS;
  const sig = hmacHex(config.appSecret, `att:${id}:${exp}:${inline ? 1 : 0}`);
  return `/api/attachments/${id}/download?e=${exp}&s=${sig}${inline ? '&inline=1' : ''}`;
}

export function verifyAttachmentSignature(config: Config, id: string, exp: string | undefined, sig: string | undefined, inline: boolean): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, hmacHex(config.appSecret, `att:${id}:${exp}:${inline ? 1 : 0}`));
}

/** Types a browser may render inline without risk of script execution. */
export function isSafeInlineType(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/.test(contentType) || contentType === 'application/pdf' || /^(audio|video)\//.test(contentType) || contentType === 'text/plain';
}
