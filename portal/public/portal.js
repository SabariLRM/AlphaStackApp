// PhoneMail registration portal: phone number + OTP creates an account, then the form resets.
const $ = (id) => document.getElementById(id);
const form = $('form');
const phone = $('phone');
const otp = $('otp');
const submit = $('submit');
const error = $('error');
const resend = $('resend');
const links = $('otp-links');

let sentTo = null; // E.164 number the OTP was sent to
let otpLength = 6;
let resendTimer = null;

async function call(path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'PhoneMail' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach PhoneMail. Check your connection.'), { details: {} });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Request failed (${res.status})`), { details: data?.error?.details || {} });
  return data;
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function startResendCountdown(seconds) {
  clearInterval(resendTimer);
  let left = seconds;
  const tick = () => {
    resend.disabled = left > 0;
    resend.textContent = left > 0 ? `Resend OTP in ${left}s` : 'Resend OTP';
    left -= 1;
    if (left < 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

function reset() {
  sentTo = null;
  form.reset();
  phone.disabled = false;
  otp.disabled = true;
  otp.placeholder = 'Tap “Get OTP” first';
  links.hidden = true;
  submit.textContent = 'Get OTP';
  submit.disabled = false;
  clearInterval(resendTimer);
  showError('');
  phone.focus();
}

async function sendOtp() {
  const number = phone.value.trim();
  if (!number) {
    showError('Enter a phone number.');
    phone.focus();
    return;
  }
  submit.disabled = true;
  showError('');
  try {
    const res = await call('/portal/otp/request', { phone: number });
    sentTo = res.phone;
    phone.disabled = true;
    otp.disabled = false;
    otp.value = '';
    otp.placeholder = '•'.repeat(otpLength);
    links.hidden = false;
    submit.textContent = 'Create account';
    startResendCountdown(res.resendIn || 30);
    otp.focus();
  } catch (err) {
    showError(err.message);
    if (err.details?.retryAfter) startResendCountdown(err.details.retryAfter);
  } finally {
    submit.disabled = false;
  }
}

async function register() {
  const code = otp.value.replace(/\D/g, '');
  if (code.length < 4) {
    showError(`Enter the ${otpLength}-digit OTP sent to ${sentTo}.`);
    otp.focus();
    return;
  }
  submit.disabled = true;
  showError('');
  try {
    const res = await call('/portal/register', { phone: sentTo, code });
    $('success-address').textContent = res.address;
    $('success').hidden = false;
    reset(); // ready for the next account
  } catch (err) {
    showError(err.message);
    submit.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (submit.disabled) return;
  if (sentTo) void register();
  else void sendOtp();
});

otp.addEventListener('input', () => {
  otp.value = otp.value.replace(/\D/g, '').slice(0, otpLength);
  if (sentTo && otp.value.length === otpLength && !submit.disabled) void register();
});

phone.addEventListener('input', () => {
  $('success').hidden = true;
  showError('');
});

$('change').addEventListener('click', () => {
  const current = phone.value;
  reset();
  phone.value = current;
});

resend.addEventListener('click', () => void sendOtp());

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('success-address').textContent);
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
  } catch {
    /* clipboard unavailable (non-secure context) */
  }
});

call('/config')
  .then((cfg) => {
    otpLength = cfg.otpLength || 6;
    otp.maxLength = otpLength;
    $('dev').hidden = !cfg.devSmsOutbox;
    if (cfg.webUrl) {
      $('web-link').href = cfg.webUrl;
      $('phone-link').href = `${cfg.webUrl}/api/dev/phone`;
      $('apk-link').href = `${cfg.webUrl}/downloads/PhoneMail.apk`;
    }
    if (cfg.defaultCallingCode && cfg.defaultCallingCode !== '91') {
      $('phone-hint').textContent = `Numbers without a country code are treated as +${cfg.defaultCallingCode}.`;
    }
  })
  .catch(() => undefined);
