import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { many } from '../db/pool.js';
import { notFound } from '../lib/errors.js';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Developer SMS outbox: with SMS_PROVIDER=console nothing leaves the server, so OTPs and
 * notifications are shown here instead. Disabled automatically with any real provider.
 */
export async function devRoutes(app: FastifyInstance, ctx: AppContext) {
  const recent = () =>
    many<{ id: number; to_phone: string; body: string; purpose: string; status: string; created_at: Date }>(
      ctx.db,
      'SELECT id, to_phone, body, purpose, status, created_at FROM sms_log ORDER BY id DESC LIMIT 100',
    );

  app.get('/api/dev/sms', async () => {
    if (!ctx.config.sms.devOutbox) throw notFound();
    const rows = await recent();
    return { items: rows.map((r) => ({ id: r.id, to: r.to_phone, body: r.body, purpose: r.purpose, status: r.status, createdAt: r.created_at.toISOString() })) };
  });

  app.get('/api/dev/sms/view', async (_req, reply) => {
    if (!ctx.config.sms.devOutbox) throw notFound();
    const rows = await recent();
    const items = rows
      .map(
        (r) => `<li class="${esc(r.purpose)}"><div class="meta"><b>${esc(r.to_phone)}</b><span>${esc(r.purpose)} · ${esc(r.status)}</span>
          <time>${esc(r.created_at.toLocaleString('en-IN', { hour12: false }))}</time></div><p>${esc(r.body).replace(/\n/g, '<br>')}</p></li>`,
      )
      .join('');
    reply.type('text/html; charset=utf-8');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>PhoneMail · Dev SMS outbox</title>
<style>
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#efeae2;color:#111b21}
header{background:#008069;color:#fff;padding:16px 20px}header h1{margin:0;font-size:18px}header p{margin:4px 0 0;opacity:.85;font-size:13px}
ul{list-style:none;margin:0 auto;padding:16px;max-width:720px}li{background:#fff;border-radius:8px;padding:10px 14px;margin:0 0 10px;box-shadow:0 1px .5px rgba(11,20,26,.13)}
li.otp{border-left:4px solid #25d366}li.notification{border-left:4px solid #53bdeb}li.welcome{border-left:4px solid #ffb300}
.meta{display:flex;gap:10px;align-items:baseline;font-size:12px;color:#667781}.meta b{color:#111b21;font-size:14px}.meta time{margin-left:auto}
p{margin:6px 0 0;white-space:pre-wrap}.empty{text-align:center;color:#667781;padding:40px}
</style></head><body><header><h1>Dev SMS outbox</h1><p>SMS_PROVIDER=console — messages are not sent; they appear here (auto-refreshes).</p></header>
<ul>${items || '<li class="empty">No messages yet. Request an OTP to see it here.</li>'}</ul></body></html>`;
  });
}
