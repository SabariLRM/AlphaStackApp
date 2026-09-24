import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import { notFound } from '../lib/errors.js';
import { deleteForever, emptyFolder, moveEntries, setFlags } from '../services/mail/actions.js';
import { folderCounts, getMessage, listMessages } from '../services/mail/queries.js';
import { sendEmail } from '../services/mail/send.js';
import { idParams, intQuery } from './util.js';

const recipientList = z.array(z.string().min(1).max(320)).max(50).optional().default([]);

export const composeSchema = z.object({
  to: recipientList,
  cc: recipientList,
  bcc: recipientList,
  subject: z.string().max(1000).optional().default(''),
  body: z.string().max(600_000).optional().default(''),
  fromAddress: z.string().max(320).optional(),
  replyToEntryId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).optional().default([]),
  draftId: z.string().uuid().optional(),
});

const BATCH_ACTIONS = ['read', 'unread', 'star', 'unstar', 'trash', 'restore', 'spam', 'not_spam', 'delete'] as const;

export async function messageRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/messages', async (req) => {
    const auth = requireAuth(req);
    const q = z
      .object({
        folder: z.enum(['inbox', 'sent', 'spam', 'trash', 'starred', 'all']).optional().default('inbox'),
        q: z.string().max(200).optional(),
        unread: z.enum(['true', 'false']).optional(),
        limit: intQuery(50, 1, 100),
        offset: intQuery(0, 0, 1_000_000),
      })
      .parse(req.query);
    return listMessages(ctx, auth.userId, { ...q, unreadOnly: q.unread === 'true' });
  });

  app.get('/api/messages/counts', async (req) => folderCounts(ctx.db, requireAuth(req).userId));

  app.get('/api/messages/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    return getMessage(ctx, auth.userId, id);
  });

  /** Traditional compose (Home screen / web). Two or more recipients create a group chat. */
  app.post('/api/messages', async (req) => {
    const auth = requireAuth(req);
    const body = composeSchema.parse(req.body);
    const result = await sendEmail(ctx, auth.userId, body);
    return { ...result, message: await getMessage(ctx, auth.userId, result.entryId) };
  });

  app.patch('/api/messages/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const body = z.object({ isRead: z.boolean().optional(), isStarred: z.boolean().optional() }).parse(req.body);
    if (!(await setFlags(ctx, auth.userId, [id], body)) && (body.isRead !== undefined || body.isStarred !== undefined)) throw notFound('Email not found.');
    return getMessage(ctx, auth.userId, id);
  });

  app.post('/api/messages/:id/move', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const body = z.object({ to: z.enum(['inbox', 'trash', 'spam', 'restore']) }).parse(req.body);
    return { moved: await moveEntries(ctx, auth.userId, [id], body.to) };
  });

  app.delete('/api/messages/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    return { deleted: await deleteForever(ctx, auth.userId, [id]) };
  });

  app.post('/api/messages/batch', async (req) => {
    const auth = requireAuth(req);
    const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(BATCH_ACTIONS) }).parse(req.body);
    const ids = body.ids;
    let affected = 0;
    switch (body.action) {
      case 'read':
      case 'unread':
        affected = await setFlags(ctx, auth.userId, ids, { isRead: body.action === 'read' });
        break;
      case 'star':
      case 'unstar':
        affected = await setFlags(ctx, auth.userId, ids, { isStarred: body.action === 'star' });
        break;
      case 'trash':
      case 'restore':
      case 'spam':
        affected = await moveEntries(ctx, auth.userId, ids, body.action);
        break;
      case 'not_spam':
        affected = await moveEntries(ctx, auth.userId, ids, 'inbox');
        break;
      case 'delete':
        affected = await deleteForever(ctx, auth.userId, ids);
        break;
    }
    return { affected };
  });

  app.post('/api/folders/:folder/empty', async (req) => {
    const auth = requireAuth(req);
    const { folder } = z.object({ folder: z.enum(['trash', 'spam']) }).parse(req.params);
    return { deleted: await emptyFolder(ctx, auth.userId, folder) };
  });

  /** New mail since a timestamp: polled by the Android app's background worker for notifications. */
  app.get('/api/sync/notifications', async (req) => {
    const auth = requireAuth(req);
    const q = z.object({ since: z.string().datetime({ offset: true }).optional() }).parse(req.query);
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 15 * 60_000);
    const rows = await ctx.db.query<{
      id: string;
      conversation_id: string;
      from_address: string;
      from_name: string;
      subject: string;
      snippet: string;
      created_at: Date;
    }>(
      `SELECT me.id, me.conversation_id, e.from_address, e.from_name, e.subject, e.snippet, me.created_at
         FROM mailbox_entries me JOIN emails e ON e.id = me.email_id
        WHERE me.user_id = $1 AND me.folder = 'inbox' AND NOT me.is_read AND me.created_at > $2
        ORDER BY me.created_at DESC LIMIT 20`,
      [auth.userId, since],
    );
    return {
      now: new Date().toISOString(),
      items: rows.rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        from: { address: r.from_address, name: r.from_name },
        subject: r.subject,
        snippet: r.snippet,
        createdAt: r.created_at.toISOString(),
      })),
    };
  });
}
