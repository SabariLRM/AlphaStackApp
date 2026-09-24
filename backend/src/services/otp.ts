import type { AppContext } from '../context.js';
import { one } from '../db/pool.js';
import { hmacHex, randomDigits, safeEqual } from '../lib/crypto.js';
import { AppError, badRequest, conflict, tooManyRequests, unprocessable } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { twilioCheckVerification, twilioStartVerification } from './sms/providers.js';
import { getUserByPhone } from './users.js';

export type OtpPurpose = 'login' | 'register';

const APP_HASH_RE = /^[A-Za-z0-9+/]{11}$/;

interface ChallengeRow {
  id: string;
  phone: string;
  provider: string;
  code_hash: string | null;
  attempts: number;
  created_at: Date;
  expires_at: Date;
}

export function parsePhoneOrThrow(ctx: AppContext, input: string): string {
  const phone = normalizePhone(input, ctx.config.defaultCountry);
  if (!phone) throw unprocessable('invalid_phone', 'Please enter a valid phone number.');
  return phone.e164;
}

const codeHash = (ctx: AppContext, phone: string, code: string) => hmacHex(ctx.config.appSecret, `otp:${phone}:${code}`);

export function otpMessage(code: string, ttlSeconds: number, appHash?: string): string {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  const text = `Your PhoneMail code is ${code}. It expires in ${minutes} min. Don't share it with anyone.`;
  // Android's SMS Retriever API reads the code automatically when the SMS ends with the app's hash.
  return appHash ? `${text}\n\n${appHash}` : text;
}

export async function requestOtp(
  ctx: AppContext,
  input: { phone: string; purpose: OtpPurpose; ip?: string; appHash?: string },
): Promise<{ phone: string; expiresIn: number; resendIn: number }> {
  const { config, db } = ctx;
  const phone = parsePhoneOrThrow(ctx, input.phone);
  const appHash = input.appHash && APP_HASH_RE.test(input.appHash) ? input.appHash : undefined;

  if (input.purpose === 'register' && (await getUserByPhone(db, phone))) {
    throw conflict('account_exists', 'An account already exists for this phone number.');
  }

  const last = await one<{ created_at: Date }>(db, 'SELECT created_at FROM otp_challenges WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [phone]);
  if (last) {
    const wait = Math.ceil(config.otp.resendSeconds - (Date.now() - last.created_at.getTime()) / 1000);
    if (wait > 0) throw tooManyRequests(`Please wait ${wait}s before requesting another code.`, wait);
  }
  const perPhone = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM otp_challenges WHERE phone = $1 AND created_at > now() - interval '1 hour'`, [phone]);
  if ((perPhone?.n ?? 0) >= config.otp.maxPerHour) throw tooManyRequests('Too many codes requested for this number. Try again later.', 3600);
  if (input.ip) {
    const perIp = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM otp_challenges WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [input.ip]);
    if ((perIp?.n ?? 0) >= config.otp.maxPerIpPerHour) throw tooManyRequests('Too many code requests from your network. Try again later.', 3600);
  }

  // Only the newest code is valid.
  await db.query('UPDATE otp_challenges SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL', [phone]);

  if (config.otp.provider === 'twilio_verify') {
    const challenge = await one<ChallengeRow>(
      db,
      `INSERT INTO otp_challenges (phone, purpose, provider, ip, expires_at)
       VALUES ($1, $2, 'twilio_verify', $3, now() + interval '10 minutes') RETURNING *`,
      [phone, input.purpose, input.ip ?? null],
    );
    try {
      await twilioStartVerification(config.twilio, phone, appHash);
      await db.query(
        `INSERT INTO sms_log (to_phone, body, purpose, provider, status) VALUES ($1, $2, 'otp', 'twilio_verify', 'sent')`,
        [phone, '[twilio_verify template] verification code'],
      );
    } catch (err) {
      await db.query('DELETE FROM otp_challenges WHERE id = $1', [challenge!.id]);
      ctx.log.error({ err: (err as Error).message, phone }, 'twilio verify start failed');
      throw new AppError(502, 'sms_failed', 'We could not send the verification SMS. Please try again.');
    }
    return { phone, expiresIn: 600, resendIn: config.otp.resendSeconds };
  }

  const code = randomDigits(config.otp.length);
  const challenge = await one<ChallengeRow>(
    db,
    `INSERT INTO otp_challenges (phone, purpose, provider, code_hash, ip, expires_at)
     VALUES ($1, $2, 'local', $3, $4, now() + make_interval(secs => $5)) RETURNING *`,
    [phone, input.purpose, codeHash(ctx, phone, code), input.ip ?? null, config.otp.ttlSeconds],
  );
  const user = await getUserByPhone(db, phone);
  try {
    await ctx.sms.send({ to: phone, body: otpMessage(code, config.otp.ttlSeconds, appHash), purpose: 'otp', userId: user?.id, secret: code });
  } catch {
    await db.query('DELETE FROM otp_challenges WHERE id = $1', [challenge!.id]);
    throw new AppError(502, 'sms_failed', 'We could not send the verification SMS. Please try again.');
  }
  return { phone, expiresIn: config.otp.ttlSeconds, resendIn: config.otp.resendSeconds };
}

/** Verifies a code and returns the E.164 phone number it proves ownership of. */
export async function verifyOtp(ctx: AppContext, input: { phone: string; code: string; purpose: OtpPurpose }): Promise<string> {
  const { config, db } = ctx;
  const phone = parsePhoneOrThrow(ctx, input.phone);
  const code = String(input.code ?? '').replace(/\s/g, '');
  if (!/^\d{4,10}$/.test(code)) throw badRequest('otp_invalid', 'Enter the code we sent you by SMS.');

  const challenge = await one<ChallengeRow>(
    db,
    `SELECT * FROM otp_challenges
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [phone, input.purpose],
  );
  if (!challenge) throw badRequest('otp_expired', 'This code has expired. Please request a new one.');

  const bumped = await one<{ attempts: number }>(
    db,
    'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 RETURNING attempts',
    [challenge.id, config.otp.maxAttempts],
  );
  if (!bumped) throw tooManyRequests('Too many wrong attempts. Please request a new code.');

  let valid: boolean;
  if (challenge.provider === 'twilio_verify') {
    try {
      valid = await twilioCheckVerification(config.twilio, phone, code);
    } catch (err) {
      ctx.log.error({ err: (err as Error).message }, 'twilio verify check failed');
      throw new AppError(502, 'otp_check_failed', 'Could not verify the code right now. Please try again.');
    }
  } else {
    valid = challenge.code_hash !== null && safeEqual(challenge.code_hash, codeHash(ctx, phone, code));
  }

  if (!valid) {
    const left = config.otp.maxAttempts - bumped.attempts;
    if (left <= 0) throw tooManyRequests('Too many wrong attempts. Please request a new code.');
    throw badRequest('otp_invalid', `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`, { attemptsLeft: left });
  }

  const consumed = await db.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [challenge.id]);
  if (!consumed.rowCount) throw badRequest('otp_expired', 'This code was already used. Please request a new one.');
  return phone;
}
