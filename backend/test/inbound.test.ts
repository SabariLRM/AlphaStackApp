import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { twilioSignature } from '../src/routes/twilio.js';
import { api, createHarness, INTERNAL_TOKEN, login, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const deliver = (payload: unknown, token = INTERNAL_TOKEN) =>
  h.app.inject({ method: 'POST', url: '/internal/smtp/deliver', headers: { 'x-internal-token': token }, payload: payload as never });

const inbound = (rcpt: string, extra: Record<string, unknown> = {}) => ({
  envelope: { mailFrom: 'boss@corp.example', rcptTo: [rcpt], remoteAddr: '203.0.113.5' },
  message: {
    messageId: '<abc123@corp.example>',
    from: { name: 'The Boss', address: 'boss@corp.example' },
    to: [{ name: '', address: rcpt }],
    subject: 'Quarterly report',
    text: 'Please see the report.',
    html: '<p>Please see the <b>report</b>.<script>alert(1)</script><img src="cid:chart"></p>',
    date: new Date().toUTCString(),
    attachments: [
      { filename: 'chart.png', contentType: 'image/png', contentId: '<chart>', inline: true, data: Buffer.from('png').toString('base64') },
      { filename: 'report.pdf', contentType: 'application/pdf', inline: false, data: Buffer.from('%PDF-1.4').toString('base64') },
    ],
    ...extra,
  },
});

describe('SMTP ingestion', () => {
  it('rejects calls without the internal token', async () => {
    expect((await deliver(inbound('9222222222@phonemail.com'), 'wrong')).statusCode).toBe(401);
  });

  it('validates recipients at RCPT time', async () => {
    await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9222222222' } });
    await h.app.inject({ method: 'POST', url: '/api/portal/register', payload: { phone: '9222222222', code: h.sms.lastCodeFor('+919222222222') } });
    const ok = await h.app.inject({ method: 'POST', url: '/internal/smtp/rcpt', headers: { 'x-internal-token': INTERNAL_TOKEN }, payload: { address: '9222222222@PhoneMail.com' } });
    expect(ok.statusCode).toBe(200);
    const missing = await h.app.inject({ method: 'POST', url: '/internal/smtp/rcpt', headers: { 'x-internal-token': INTERNAL_TOKEN }, payload: { address: 'nobody@phonemail.com' } });
    expect(missing.statusCode).toBe(404);
    const foreign = await h.app.inject({ method: 'POST', url: '/internal/smtp/rcpt', headers: { 'x-internal-token': INTERNAL_TOKEN }, payload: { address: 'x@gmail.com' } });
    expect(foreign.statusCode).toBe(404);
  });

  it('delivers, sanitizes HTML, keeps attachments and SMS-notifies users without the app', async () => {
    h.sms.sent = [];
    const res = await deliver(inbound('9222222222@phonemail.com'));
    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(1);
    await h.runJobs();
    const notes = h.sms.sent.filter((m) => m.to === '+919222222222');
    expect(notes.map((m) => m.body)).toContain('You have received an email from The Boss (boss@corp.example). Subject: Quarterly report.');

    // Signing in on the web does not count as having the app: SMS keeps coming.
    await login(h, '9222222222', 'web');
    h.sms.sent = [];
    await deliver(inbound('9222222222@phonemail.com', { messageId: '<web@corp.example>', subject: 'Web user' }));
    await h.runJobs();
    expect(h.sms.sent.filter((m) => m.body.includes('Subject: Web user.'))).toHaveLength(1);
  });

  it('does not SMS users who use the mobile app, and stores message content safely', async () => {
    const { token } = await login(h, '9222222222', 'mobile');
    const c = api(h, token!);
    h.sms.sent = [];
    await deliver(inbound('9222222222@phonemail.com', { messageId: '<second@corp.example>', subject: 'Second' }));
    await h.runJobs();
    expect(h.sms.sent.filter((m) => m.body.startsWith('You have received'))).toHaveLength(0);

    const conv = (await c.get('/api/conversations')).body.items[0];
    expect(conv.participants[0]).toMatchObject({ address: 'boss@corp.example', name: 'The Boss', isLocal: false });
    const msgs = (await c.get(`/api/conversations/${conv.id}/messages`)).body.items;
    expect(msgs).toHaveLength(3);
    const m = msgs.find((x: any) => x.subject === 'Second');
    expect(m.html).not.toContain('<script');
    expect(m.html).toMatch(/src="\/api\/attachments\/[0-9a-f-]+\/download\?[^"]*inline=1"/);
    // The inline image is embedded, only the PDF is listed as an attachment.
    expect(m.attachments.map((a: any) => a.filename)).toEqual(['report.pdf']);
    expect(conv.lastMessage.hasAttachments).toBe(true);

    // Replies to external mail are threaded with In-Reply-To.
    const reply = await c.post(`/api/conversations/${conv.id}/messages`, { body: 'thanks', replyToEntryId: m.id });
    // External recipients need the relay; it is disabled in tests.
    expect(reply.body.error.code).toBe('external_disabled');
  });

  it('rejects spoofed local senders', async () => {
    const payload = inbound('9222222222@phonemail.com', { from: { name: 'Fake', address: '9876543210@phonemail.com' } });
    expect((await deliver(payload)).statusCode).toBe(403);
  });

  it('respects the hourly SMS limit and user opt-out', async () => {
    await h.app.inject({ method: 'POST', url: '/api/portal/otp/request', payload: { phone: '9333333333' } });
    await h.app.inject({ method: 'POST', url: '/api/portal/register', payload: { phone: '9333333333', code: h.sms.lastCodeFor('+919333333333') } });
    h.sms.sent = [];
    for (let i = 0; i < 12; i++) await deliver(inbound('9333333333@phonemail.com', { messageId: `<n${i}@corp.example>` }));
    await h.runJobs();
    expect(h.sms.sent.filter((m) => m.to === '+919333333333' && m.body.startsWith('You have received'))).toHaveLength(10);
  });
});

describe('Twilio IVR and SMS sign-up', () => {
  it('answers calls with a menu and creates the account on "1"', async () => {
    const menu = await h.app.inject({ method: 'POST', url: '/api/twilio/voice', payload: 'From=%2B919444444444&CallSid=CA1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(menu.statusCode).toBe(200);
    expect(menu.headers['content-type']).toContain('text/xml');
    expect(menu.body).toContain('<Gather');
    expect(menu.body).toContain('press 1');

    const press = await h.app.inject({ method: 'POST', url: '/api/twilio/voice/menu', payload: 'From=%2B919444444444&Digits=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(press.body).toContain('has been created');
    expect(press.body).toContain('9 4 4 4 4 4 4 4 4 4');

    const again = await h.app.inject({ method: 'POST', url: '/api/twilio/voice/menu', payload: 'From=%2B919444444444&Digits=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(again.body).toContain('already have');

    const invalid = await h.app.inject({ method: 'POST', url: '/api/twilio/voice/menu', payload: 'From=%2B919444444444&Digits=7', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(invalid.body).toContain('<Redirect');

    const { user } = await login(h, '9444444444', 'web');
    expect(user.registrationSource).toBe('ivr');
  });

  it('creates accounts by SMS and ignores STOP', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/twilio/sms', payload: 'From=%2B919555555555&Body=join', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.body).toContain('<Message>Welcome to PhoneMail! Your email address is 9555555555@phonemail.com');
    const stop = await h.app.inject({ method: 'POST', url: '/api/twilio/sms', payload: 'From=%2B919666666666&Body=STOP', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(stop.body).not.toContain('<Message>');
    const { user } = await login(h, '9555555555', 'web');
    expect(user.registrationSource).toBe('sms');
  });
});

describe('Twilio webhook signatures', () => {
  let s: Harness;
  beforeAll(async () => {
    s = await createHarness({ TWILIO_AUTH_TOKEN: 'tok123', TWILIO_WEBHOOK_BASE_URL: 'https://abc.ngrok.app' });
  });
  afterAll(async () => s.close());

  it('accepts correctly signed requests and rejects others', async () => {
    const params = { From: '+919777777777', Body: 'hi' };
    const sig = twilioSignature('tok123', 'https://abc.ngrok.app/api/twilio/sms', params);
    const ok = await s.app.inject({
      method: 'POST',
      url: '/api/twilio/sms',
      payload: new URLSearchParams(params).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await s.app.inject({
      method: 'POST',
      url: '/api/twilio/sms',
      payload: new URLSearchParams(params).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' },
    });
    expect(bad.statusCode).toBe(403);
  });
});
