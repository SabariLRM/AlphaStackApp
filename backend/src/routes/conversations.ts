import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import {
  markConversationRead,
  reportConversationSpam,
  setConversationFavorite,
  trashConversation,
} from '../services/mail/actions.js';
import { deleteConversationDraft, saveDraft } from '../services/mail/drafts.js';
import { getConversation, getOrCreateConversation, participantsFor } from '../services/mail/participants.js';
import { getConversationDto, getMessage, listConversationMessages, listConversations } from '../services/mail/queries.js';
import { resolveRecipient, sendEmail } from '../services/mail/send.js';
import { currentUser, idParams, intQuery } from './util.js';

const sendSchema = z.object({
  subject: z.string().max(1000).optional(),
  body: z.string().max(600_000).optional().default(''),
  replyToEntryId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).optional().default([]),
  fromAddress: z.string().max(320).optional(),
});

export async function conversationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/conversations', async (req) => {
    const user = await currentUser(ctx, req);
    const q = z
      .object({
        filter: z.enum(['all', 'unread', 'attachments', 'favorites']).optional().default('all'),
        q: z.string().max(200).optional(),
        limit: intQuery(100, 1, 200),
        offset: intQuery(0, 0, 100_000),
      })
      .parse(req.query);
    return { items: await listConversations(ctx, user, q) };
  });

  /** Opens (creating if needed) the one-to-one chat with a phone number or address. */
  app.post('/api/conversations/open', async (req) => {
    const user = await currentUser(ctx, req);
    const body = z.object({ target: z.string().min(1).max(320) }).parse(req.body);
    const recipient = await resolveRecipient(ctx, ctx.db, body.target);
    const participants = await participantsFor(ctx.db, user, [recipient.address]);
    const conversation = await getOrCreateConversation(ctx.db, user.id, participants);
    return getConversationDto(ctx, user, conversation.id);
  });

  app.get('/api/conversations/:id', async (req) => {
    const user = await currentUser(ctx, req);
    const { id } = idParams.parse(req.params);
    return getConversationDto(ctx, user, id);
  });

  app.get('/api/conversations/:id/messages', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const q = z.object({ before: z.string().max(100).optional(), limit: intQuery(50, 1, 100) }).parse(req.query);
    if (!(await getConversation(ctx.db, auth.userId, id))) throw notFound('Chat not found.');
    return listConversationMessages(ctx, auth.userId, id, q);
  });

  /** Sends an email inside a chat. Recipients are always the chat's participants. */
  app.post('/api/conversations/:id/messages', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const body = sendSchema.parse(req.body);
    const result = await sendEmail(ctx, auth.userId, { ...body, conversationId: id });
    return { ...result, message: await getMessage(ctx, auth.userId, result.entryId) };
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const body = z.object({ read: z.boolean().optional().default(true) }).parse(req.body ?? {});
    return { updated: await markConversationRead(ctx, auth.userId, id, body.read) };
  });

  app.patch('/api/conversations/:id', async (req) => {
    const user = await currentUser(ctx, req);
    const { id } = idParams.parse(req.params);
    const body = z.object({ isFavorite: z.boolean() }).parse(req.body);
    await setConversationFavorite(ctx, user.id, id, body.isFavorite);
    return getConversationDto(ctx, user, id);
  });

  app.delete('/api/conversations/:id', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    return { trashed: await trashConversation(ctx, auth.userId, id) };
  });

  app.post('/api/conversations/:id/spam', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    return { moved: await reportConversationSpam(ctx, auth.userId, id) };
  });

  // The chat composer's unsent text, kept server-side so it follows the user across devices.
  app.get('/api/conversations/:id/draft', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    if (!(await getConversation(ctx.db, auth.userId, id))) throw notFound('Chat not found.');
    const draft = await one<{ id: string; subject: string; body: string; reply_to_entry_id: string | null; updated_at: Date }>(
      ctx.db,
      'SELECT id, subject, body, reply_to_entry_id, updated_at FROM drafts WHERE conversation_id = $1 AND user_id = $2',
      [id, auth.userId],
    );
    return {
      draft: draft
        ? { id: draft.id, subject: draft.subject, body: draft.body, replyToEntryId: draft.reply_to_entry_id, updatedAt: draft.updated_at.toISOString() }
        : null,
    };
  });

  app.put('/api/conversations/:id/draft', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const body = z
      .object({ subject: z.string().max(1000).optional().default(''), body: z.string().max(600_000).optional().default(''), replyToEntryId: z.string().uuid().nullish() })
      .parse(req.body);
    if (!body.subject.trim() && !body.body.trim()) {
      await deleteConversationDraft(ctx, auth.userId, id);
      return { draft: null };
    }
    const draft = await saveDraft(ctx, auth.userId, null, { conversationId: id, subject: body.subject, body: body.body, replyToEntryId: body.replyToEntryId ?? null });
    return { draft: { id: draft.id, subject: draft.subject, body: draft.body, replyToEntryId: draft.replyToEntryId, updatedAt: draft.updatedAt } };
  });

  app.delete('/api/conversations/:id/draft', async (req) => {
    const auth = requireAuth(req);
    const { id } = idParams.parse(req.params);
    await deleteConversationDraft(ctx, auth.userId, id);
    return { ok: true };
  });
}
