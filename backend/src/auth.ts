import type { FastifyRequest } from 'fastify';
import { unauthorized } from './lib/errors.js';
import type { ClientKind } from './services/sessions.js';

export const SESSION_COOKIE = 'pm_session';
export const CSRF_HEADER = 'x-requested-with';

export interface AuthInfo {
  userId: string;
  sessionId: string;
  client: ClientKind;
  viaCookie: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

export function requireAuth(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
