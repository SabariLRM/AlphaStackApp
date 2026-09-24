/**
 * "Local phone": a browser page that stands in for a real phone while everything runs locally.
 * It calls the IVR and texts the SMS number through the same webhook endpoints Twilio would use,
 * and shows the SMS PhoneMail sends to that number (OTPs, welcome texts, new-mail alerts).
 * Served only in local mode (SMS_PROVIDER=console). The script is a separate file so the web
 * client's strict CSP (script-src 'self') allows it.
 */
export const devPhoneHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PhoneMail · Local phone</title>
<style>
:root{--g:#008069;--g2:#25d366;--bg:#efeae2;--card:#fff;--t:#111b21;--m:#667781;--out:#d9fdd3;--line:#e9edef}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--card:#111b21;--t:#e9edef;--m:#8696a0;--out:#005c4b;--line:#222d34}}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--t)}
header{background:var(--g);color:#fff;padding:16px 20px}
header h1{margin:0;font-size:19px}header p{margin:4px 0 0;opacity:.9;font-size:13px}
main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
section{background:var(--card);border-radius:12px;padding:16px;box-shadow:0 1px .5px rgba(11,20,26,.13)}
h2{margin:0 0 10px;font-size:16px}
label{display:block;font-size:13px;color:var(--m);margin-bottom:6px}
input{width:100%;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--t);font-size:16px}
button{height:40px;padding:0 18px;border:0;border-radius:20px;background:var(--g);color:#fff;font-weight:600;cursor:pointer}
button.alt{background:transparent;color:var(--g);border:1px solid var(--line)}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
.keypad{display:grid;grid-template-columns:repeat(3,56px);gap:8px;margin-top:12px}
.keypad button{width:56px;height:56px;border-radius:50%;font-size:20px;padding:0}
.log{margin-top:12px;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}
.b{max-width:90%;padding:8px 10px;border-radius:8px;white-space:pre-wrap;word-break:break-word}
.b.in{background:var(--bg);align-self:flex-start}.b.out{background:var(--out);align-self:flex-end}
.b small{display:block;color:var(--m);font-size:11px;margin-top:2px}
.sys{font-size:12px;color:var(--m);text-align:center}
.code{font-weight:700;letter-spacing:2px}
.hint{font-size:12px;color:var(--m);margin-top:8px}
a{color:var(--g)}
</style>
</head>
<body>
<header><h1>📱 Local phone</h1><p>Everything runs on your computer: call PhoneMail's toll-free number, text it, and read the SMS it sends you. No Twilio, no SMS charges.</p></header>
<main>
  <section>
    <h2>Your phone</h2>
    <label for="me">Your phone number</label>
    <input id="me" inputmode="tel" value="+91 98765 43210">
    <p class="hint">Use the same number when you sign in on the <a href="/" target="_blank">web client</a>, the <a id="portal" href="http://localhost:8089" target="_blank">portal</a> or the Android app — codes and alerts for it show up under “SMS inbox”.</p>
  </section>
  <section>
    <h2>☎️ Call the toll-free number</h2>
    <div class="row"><button id="call">Call PhoneMail</button><button id="hang" class="alt" disabled>Hang up</button>
      <label style="margin:0 0 0 auto;display:flex;gap:6px;align-items:center"><input id="speak" type="checkbox" checked style="width:auto;height:auto"> Speak</label></div>
    <div class="keypad" id="keypad"></div>
    <div class="log" id="calllog"></div>
  </section>
  <section>
    <h2>💬 Text the SMS number</h2>
    <div class="row" style="margin-top:0"><input id="text" value="JOIN" style="flex:1"><button id="send">Send</button></div>
    <p class="hint">Text <b>JOIN</b> to create an account, <b>HELP</b> for help.</p>
    <div class="log" id="textlog"></div>
  </section>
  <section>
    <h2>📥 SMS inbox for this number</h2>
    <p class="hint" style="margin-top:0">OTP codes, welcome texts and “You have received an email…” alerts. Updates every 3 seconds.</p>
    <div class="log" id="inbox"><div class="sys">No messages yet.</div></div>
  </section>
</main>
<script src="/api/dev/phone.js"></script>
</body>
</html>`;

export const devPhoneJs = `(() => {
  const $ = (id) => document.getElementById(id);
  const me = $('me');
  try { me.value = localStorage.getItem('pm.phone') || me.value; } catch {}
  me.addEventListener('change', () => { try { localStorage.setItem('pm.phone', me.value); } catch {}; refreshInbox(); });

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const bubble = (log, text, dir, note) => {
    const div = document.createElement('div');
    div.className = dir === 'sys' ? 'sys' : 'b ' + dir;
    div.innerHTML = esc(text) + (note ? '<small>' + esc(note) + '</small>' : '');
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };
  const e164 = () => me.value.replace(/[^+\\d]/g, '');

  async function webhook(path, params) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const text = await res.text();
    if (!res.ok) throw new Error(res.status === 403 ? 'Twilio signature checks are on (TWILIO_AUTH_TOKEN is set), so the local phone cannot call.' : 'Request failed (' + res.status + ')');
    return new DOMParser().parseFromString(text, 'text/xml');
  }

  // ---- Call ----
  let inCall = false;
  const callLog = $('calllog');
  const keypad = $('keypad');
  const say = (text) => {
    bubble(callLog, text, 'in', 'PhoneMail');
    if ($('speak').checked && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-IN';
      speechSynthesis.speak(u);
    }
  };
  const endCall = (why) => {
    inCall = false;
    keypad.innerHTML = '';
    $('call').disabled = false;
    $('hang').disabled = true;
    if (why) bubble(callLog, why, 'sys');
  };
  async function play(path, params) {
    try {
      const doc = await webhook(path, Object.assign({ From: e164(), To: '+18001234567', CallSid: 'CAlocal', Direction: 'inbound' }, params));
      const root = doc.documentElement;
      let gather = false;
      for (const node of Array.from(root.children)) {
        if (node.tagName === 'Say') say(node.textContent);
        if (node.tagName === 'Gather') {
          // Wait for a key press; what follows a Gather only plays on timeout.
          gather = true;
          for (const s of Array.from(node.getElementsByTagName('Say'))) say(s.textContent);
          break;
        }
        if (node.tagName === 'Redirect') return play(node.textContent.trim(), {});
        if (node.tagName === 'Hangup') return endCall('Call ended.');
      }
      if (gather) showKeypad(); else endCall('Call ended.');
    } catch (err) {
      endCall(err.message);
    }
  }
  function showKeypad() {
    keypad.innerHTML = '';
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) {
      const b = document.createElement('button');
      b.textContent = k;
      b.onclick = () => {
        if (!inCall) return;
        keypad.innerHTML = '';
        bubble(callLog, 'Pressed ' + k, 'out');
        play('/api/twilio/voice/menu', { Digits: k });
      };
      keypad.appendChild(b);
    }
  }
  $('call').onclick = () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    callLog.innerHTML = '';
    inCall = true;
    $('call').disabled = true;
    $('hang').disabled = false;
    bubble(callLog, 'Calling 1800-123-4567 from ' + me.value + '…', 'sys');
    play('/api/twilio/voice', {});
  };
  $('hang').onclick = () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    endCall('You hung up.');
  };

  // ---- Text ----
  $('send').onclick = async () => {
    const body = $('text').value.trim();
    if (!body) return;
    bubble($('textlog'), body, 'out', 'You → PhoneMail');
    try {
      const doc = await webhook('/api/twilio/sms', { From: e164(), To: '+18001234567', Body: body, MessageSid: 'SMlocal' });
      const reply = doc.getElementsByTagName('Message')[0];
      bubble($('textlog'), reply ? reply.textContent : '(no reply)', 'in', 'PhoneMail');
    } catch (err) {
      bubble($('textlog'), err.message, 'sys');
    }
  };

  // ---- Inbox ----
  let last = '';
  async function refreshInbox() {
    try {
      const res = await fetch('/api/dev/sms?phone=' + encodeURIComponent(me.value));
      if (!res.ok) return;
      const data = await res.json();
      const key = JSON.stringify(data.items.map((m) => m.id));
      if (key === last) return;
      last = key;
      const box = $('inbox');
      box.innerHTML = '';
      if (!data.items.length) return bubble(box, 'No messages yet.', 'sys');
      for (const m of data.items.slice().reverse()) {
        const div = document.createElement('div');
        div.className = 'b in';
        div.innerHTML = esc(m.body).replace(/(code is )(\\d{4,8})/, '$1<span class="code">$2</span>') +
          '<small>' + esc(m.purpose) + ' · ' + new Date(m.createdAt).toLocaleTimeString() + '</small>';
        box.appendChild(div);
      }
      box.scrollTop = box.scrollHeight;
    } catch {}
  }
  fetch('/api/config').then((r) => r.json()).then((c) => { if (c.portalUrl) $('portal').href = c.portalUrl; }).catch(() => {});
  refreshInbox();
  setInterval(refreshInbox, 3000);
})();
`;
