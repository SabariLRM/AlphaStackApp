import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CountryCode } from 'libphonenumber-js';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { countries, formatAsYouType, toE164 } from '../lib/phone';

/** Single-screen sign in / sign up: phone number, OTP and one Next button. */
export function LoginPage() {
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useMemo(countries, []);
  const [country, setCountry] = useState<CountryCode>('IN');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const otpRef = useRef<HTMLInputElement>(null);
  const otpLength = config?.otpLength ?? 6;

  useEffect(() => {
    if (config?.defaultCountry) setCountry(config.defaultCountry as CountryCode);
  }, [config?.defaultCountry]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const e164 = toE164(phone, country);

  const sendCode = async () => {
    if (!e164) {
      setError('Enter a valid phone number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.requestOtp(e164);
      setSentTo(res.phone);
      setResendIn(res.resendIn);
      setCode('');
      window.setTimeout(() => otpRef.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code.');
      if (err instanceof ApiError && typeof err.details?.retryAfter === 'number') setResendIn(err.details.retryAfter);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!sentTo) return;
    if (code.length < 4) {
      setError(`Enter the ${otpLength}-digit code we sent you.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.verifyOtp(sentTo, code);
      qc.setQueryData(['me'], res.user);
      navigate(res.isNewUser ? '/settings/general?welcome=1' : '/mail/inbox', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code.');
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (sentTo) void verify();
    else void sendCode();
  };

  // Verify automatically once all digits are typed or pasted.
  useEffect(() => {
    if (sentTo && code.length === otpLength && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const selected = list.find((c) => c.code === country);

  return (
    <div className="auth-page">
      <div>
        <form className="auth-card" onSubmit={onSubmit} noValidate>
          <img className="logo" src="/favicon.svg" alt="" />
          <h1>Sign in</h1>
          <p className="lead">to continue to PhoneMail. New here? Your account is created automatically.</p>

          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <div className="phone-row">
              <select
                className="select"
                aria-label="Country code"
                value={country}
                disabled={!!sentTo}
                onChange={(e) => setCountry(e.target.value as CountryCode)}
              >
                {list.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} +{c.dial}
                  </option>
                ))}
              </select>
              <input
                id="phone"
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={selected?.code === 'IN' ? '98765 43210' : 'Phone number'}
                value={phone}
                disabled={!!sentTo}
                autoFocus
                onChange={(e) => setPhone(formatAsYouType(e.target.value, country))}
              />
            </div>
            {config && (
              <span className="hint">
                Your email address will be <b>{e164 ? (e164.startsWith(`+${config.defaultCallingCode}`) ? e164.slice(config.defaultCallingCode.length + 1) : e164.slice(1)) : 'your number'}@{config.mailDomain}</b>
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="otp">One-time password (OTP)</label>
            <input
              id="otp"
              ref={otpRef}
              className="input otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={otpLength}
              placeholder={sentTo ? '•'.repeat(otpLength) : 'Tap Next to get a code'}
              value={code}
              disabled={!sentTo}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, otpLength))}
            />
          </div>
          {sentTo && (
            <div className="row-links">
              <button type="button" className="link-btn" onClick={() => (setSentTo(null), setCode(''), setError(''))}>
                Change number
              </button>
              <button type="button" className="link-btn" disabled={resendIn > 0 || busy} onClick={() => void sendCode()}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          )}

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <p className="terms">
            By signing up, you agree to the <Link to="/terms">Terms of Service</Link>
          </p>
          <button className="btn primary next" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Next'}
          </button>

          {config?.devSmsOutbox && (
            <div className="dev-note">
              Everything runs locally: SMS are not really sent. Open the <a href="/api/dev/phone" target="_blank" rel="noreferrer">local phone</a> to see your code (or
              call and text PhoneMail from it).
            </div>
          )}
        </form>
        <div className="auth-foot">
          <span>PhoneMail · your number is your email</span>
          <span style={{ display: 'flex', gap: 16 }}>
            <a href="/downloads/PhoneMail.apk">Get the Android app</a>
            <Link to="/terms">Terms</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
