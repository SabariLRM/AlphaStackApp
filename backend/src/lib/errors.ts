export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do that.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const payloadTooLarge = (message: string) => new AppError(413, 'payload_too_large', message);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) => new AppError(422, code, message, details);
export const tooManyRequests = (message: string, retryAfterSeconds?: number) =>
  new AppError(429, 'rate_limited', message, retryAfterSeconds ? { retryAfter: retryAfterSeconds } : undefined);
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
