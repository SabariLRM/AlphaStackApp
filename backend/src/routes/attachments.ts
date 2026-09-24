import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors.js';
import { isSafeInlineType, sanitizeContentType, sanitizeFilename, verifyAttachmentSignature, type AttachmentRow } from '../services/mail/attachments.js';
import { TooLargeError } from '../services/storage.js';
import { idParams } from './util.js';

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function attachmentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/attachments', async (req) => {
    const auth = requireAuth(req);
    if (!req.isMultipart()) throw badRequest('not_multipart', 'Upload the file as multipart/form-data.');
    const file = await req.file();
    if (!file) throw badRequest('no_file', 'Choose a file to attach.');
    let saved: { key: string; size: number };
    try {
      saved = await ctx.storage.saveStream('attachments', file.file, ctx.config.maxAttachmentBytes);
    } catch (err) {
      if (err instanceof TooLargeError || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw payloadTooLarge(`Attachments must be smaller than ${Math.floor(ctx.config.maxAttachmentBytes / 1024 / 1024)} MB.`);
      }
      throw err;
    }
    if (file.file.truncated) {
      await ctx.storage.remove(saved.key);
      throw payloadTooLarge(`Attachments must be smaller than ${Math.floor(ctx.config.maxAttachmentBytes / 1024 / 1024)} MB.`);
    }
    const row = await one<AttachmentRow>(
      ctx.db,
      `INSERT INTO attachments (owner_id, filename, content_type, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [auth.userId, sanitizeFilename(file.filename), sanitizeContentType(file.mimetype), saved.size, saved.key],
    );
    return { id: row!.id, filename: row!.filename, contentType: row!.content_type, size: row!.size_bytes };
  });

  /** Removes an upload that has not been sent yet. */
  app.delete('/api/attachments/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const row = await one<AttachmentRow>(ctx.db, 'DELETE FROM attachments WHERE id = $1 AND owner_id = $2 AND email_id IS NULL RETURNING *', [id, auth.userId]);
    if (!row) throw notFound('Attachment not found.');
    await ctx.storage.remove(row.storage_key);
    return { ok: true };
  });

  app.get('/api/attachments/:id/download', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const q = z.object({ e: z.string().optional(), s: z.string().optional(), inline: z.string().optional() }).parse(req.query);
    const wantsInline = q.inline === '1';
    const row = await one<AttachmentRow>(ctx.db, 'SELECT * FROM attachments WHERE id = $1', [id]);
    if (!row) throw notFound('Attachment not found.');

    let allowed = verifyAttachmentSignature(ctx.config, id, q.e, q.s, wantsInline);
    if (!allowed && req.auth) {
      const access = await one(
        ctx.db,
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM mailbox_entries WHERE user_id = $1 AND email_id = $2)
            OR ($3::uuid IS NOT NULL AND $3::uuid = $1)`,
        [req.auth.userId, row.email_id, row.email_id ? null : row.owner_id],
      );
      allowed = !!access;
    }
    if (!allowed) throw notFound('Attachment not found.');
    if (!(await ctx.storage.exists(row.storage_key))) throw notFound('Attachment file is missing.');

    const inline = wantsInline && isSafeInlineType(row.content_type);
    reply.header('Content-Type', inline ? row.content_type : row.content_type === 'text/html' ? 'application/octet-stream' : row.content_type);
    reply.header('Content-Length', String(row.size_bytes));
    reply.header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.filename));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(ctx.storage.open(row.storage_key));
  });
}
