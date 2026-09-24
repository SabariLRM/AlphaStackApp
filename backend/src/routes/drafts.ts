import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import { deleteDraft, getDraft, listDrafts, saveDraft } from '../services/mail/drafts.js';
import { idParams } from './util.js';

const recipientList = z.array(z.string().max(320)).max(50).optional();

const draftSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  replyToEntryId: z.string().uuid().nullish(),
  fromAddress: z.string().max(320).nullish(),
  to: recipientList,
  cc: recipientList,
  bcc: recipientList,
  subject: z.string().max(1000).optional(),
  body: z.string().max(600_000).optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
});

export async function draftRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/drafts', async (req) => ({ items: await listDrafts(ctx, requireAuth(req).userId) }));

  app.get('/api/drafts/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return getDraft(ctx, requireAuth(req).userId, id);
  });

  app.post('/api/drafts', async (req) => saveDraft(ctx, requireAuth(req).userId, null, draftSchema.parse(req.body)));

  app.put('/api/drafts/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return saveDraft(ctx, requireAuth(req).userId, id, draftSchema.parse(req.body));
  });

  app.delete('/api/drafts/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    await deleteDraft(ctx, requireAuth(req).userId, id);
    return { ok: true };
  });
}
