import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createHarness, login, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

describe('OTP sign-in / sign-up', () => {
  it('creates an account whose address is the phone number', async () => {
    const res = await login(h, '98765 43210', 'mobile');
    expect(res.isNewUser).toBe(true);
    expect(res.user.address).toBe('9876543210@phonemail.com');
    expect(res.user.phone).toBe('+919876543210');
    expect(res.user.registrationSource).toBe('mobile');
    expect(res.token).toBeTruthy();

    const again = await login(h, '+91 9876543210', 'mobile');
    expect(again.isNewUser).toBe(false);
    expect(again.user.id).toBe(res.user.id);
  });

  it('rejects wrong codes and locks after too many attempts', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '9000000001' } });
    expect(r.statusCode).toBe(200);
    const code = h.sms.lastCodeFor('+919000000001');
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code: wrong } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('otp_invalid');
    for (let i = 0; i < 3; i++) await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code: wrong } });
    const locked = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code: wrong } });
    expect(locked.statusCode).toBe(429);
    // Even the right code no longer works for this challenge.
    const right = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code } });
    expect(right.statusCode).toBe(429);
  });

  it('codes are single use and only the newest code is valid', async () => {
    await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '9000000002' } });
    const first = h.sms.lastCodeFor('+919000000002');
    await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '9000000002' } });
    const second = h.sms.lastCodeFor('+919000000002');
    if (first !== second) {
      const old = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000002', code: first } });
      expect(old.statusCode).toBe(400);
    }
    const ok = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000002', code: second } });
    expect(ok.statusCode).toBe(200);
    const reuse = await h.app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000002', code: second } });
    expect(reuse.statusCode).toBe(400);
  });

  it('validates phone numbers', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: 'abc' } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('invalid_phone');
  });

  it('web sessions use an httpOnly cookie and require the CSRF header for writes', async () => {
    const res = await login(h, '9000000003', 'web');
    expect(res.token).toBeUndefined();
    expect(res.cookie).toBeTruthy();
    const me = await h.app.inject({ method: 'GET', url: '/api/me', cookies: { pm_session: res.cookie! } });
    expect(me.statusCode).toBe(200);
    expect(me.json().registrationSource).toBe('web');
    const noHeader = await h.app.inject({ method: 'PATCH', url: '/api/me', cookies: { pm_session: res.cookie! }, payload: { displayName: 'X' } });
    expect(noHeader.statusCode).toBe(403);
    const withHeader = await h.app.inject({
      method: 'PATCH',
      url: '/api/me',
      cookies: { pm_session: res.cookie! },
      headers: { 'x-requested-with': 'PhoneMail' },
      payload: { displayName: 'Web User' },
    });
    expect(withHeader.statusCode).toBe(200);
    expect(withHeader.json().displayName).toBe('Web User');
  });

  it('logout revokes the session', async () => {
    const { token } = await login(h, '9000000004');
    const client = api(h, token!);
    expect((await client.get('/api/me')).status).toBe(200);
    expect((await client.post('/api/auth/logout')).status).toBe(200);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('manages sessions, profile, aliases', async () => {
    const { token } = await login(h, '9000000005');
    const c = api(h, token!);
    const sessions = await c.get('/api/me/sessions');
    expect(sessions.body.items).toHaveLength(1);
    expect(sessions.body.items[0].current).toBe(true);

    const patched = await c.patch('/api/me', { displayName: 'Asha', about: 'Hi there', language: 'ta', smsNotifications: false });
    expect(patched.body).toMatchObject({ displayName: 'Asha', about: 'Hi there', language: 'ta', smsNotifications: false });
    expect((await c.patch('/api/me', { language: 'xx' })).status).toBe(400);

    const alias = await c.post('/api/me/aliases', { alias: 'asha' });
    expect(alias.body.address).toBe('asha@phonemail.com');
    expect((await c.post('/api/me/aliases', { alias: '9123456789' })).status).toBe(422);
    const other = api(h, (await login(h, '9000000006')).token!);
    expect((await other.post('/api/me/aliases', { alias: 'asha' })).status).toBe(409);
    expect((await c.get('/api/me')).body.aliases).toEqual(['asha@phonemail.com']);
    expect((await c.del('/api/me/aliases/asha@phonemail.com')).status).toBe(200);
    expect((await c.get('/api/me')).body.aliases).toEqual([]);
  });

  it('exposes public config', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/config' });
    expect(r.json()).toMatchObject({ mailDomain: 'phonemail.com', defaultCallingCode: '91', otpLength: 6 });
  });
});

describe('registration portal', () => {
  it('creates an account with phone + OTP only, and refuses existing numbers', async () => {
    const req = await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9111111111' } });
    expect(req.statusCode).toBe(200);
    const code = h.sms.lastCodeFor('+919111111111');
    const reg = await h.app.inject({ method: 'POST', url: '/api/portal/register', payload: { phone: '9111111111', code } });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().address).toBe('9111111111@phonemail.com');

    const again = await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9111111111' } });
    expect(again.statusCode).toBe(409);

    // A welcome SMS is queued and sent by the worker.
    await h.runJobs();
    expect(h.sms.sent.some((m) => m.to === '+919111111111' && m.body.includes('9111111111@phonemail.com'))).toBe(true);
  });

  it('works in a browser that also holds a web-client session cookie', async () => {
    const web = await login(h, '9111111113', 'web');
    const r = await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9111111114' }, cookies: { pm_session: web.cookie! } });
    expect(r.statusCode).toBe(200);
  });

  it('portal sessions are not created', async () => {
    await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9111111112' } });
    const code = h.sms.lastCodeFor('+919111111112');
    const reg = await h.app.inject({ method: 'POST', url: '/api/portal/register', payload: { phone: '9111111112', code } });
    expect(reg.cookies).toHaveLength(0);
    expect(reg.json().token).toBeUndefined();
  });
});

describe('local phone (dev mode)', () => {
  it('serves the local phone and filters the SMS outbox by number', async () => {
    const page = await h.app.inject({ method: 'GET', url: '/api/dev/phone' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('/api/dev/phone.js');
    const js = await h.app.inject({ method: 'GET', url: '/api/dev/phone.js' });
    expect(js.headers['content-type']).toContain('javascript');

    await h.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '9111122222' } });
    const mine = (await h.app.inject({ method: 'GET', url: '/api/dev/sms?phone=' + encodeURIComponent('+91 91111 22222') })).json().items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m: { to: string }) => m.to === '+919111122222')).toBe(true);
    expect((await h.app.inject({ method: 'GET', url: '/api/dev/sms?phone=abc' })).json().items).toEqual([]);
  });

  it('is not available with a real SMS provider', async () => {
    const real = await createHarness({ SMS_PROVIDER: 'smsgate', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p' });
    try {
      expect((await real.app.inject({ method: 'GET', url: '/api/dev/phone' })).statusCode).toBe(404);
      expect((await real.app.inject({ method: 'GET', url: '/api/dev/sms' })).statusCode).toBe(404);
    } finally {
      await real.close();
    }
  });
});
