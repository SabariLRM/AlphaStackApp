import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../lib/errors.js';
import { getUserById, type UserRow } from '../services/users.js';
import { requireAuth } from '../auth.js';

export const idParams = z.object({ id: z.string().uuid() });

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'bn', 'mr'] as const;

export async function currentUser(ctx: AppContext, req: FastifyRequest): Promise<UserRow> {
  const auth = requireAuth(req);
  const user = await getUserById(ctx.db, auth.userId);
  if (!user) throw notFound('Account not found.');
  return user;
}

export const intQuery = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().default(def);
