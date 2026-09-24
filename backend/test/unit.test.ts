import { describe, expect, it } from 'vitest';
import { normalizeAddress, validateAliasLocalPart } from '../src/lib/address.js';
import { makeSnippet, replySubject, sanitizeEmailHtml } from '../src/lib/html.js';
import { looksLikePhone, normalizePhone, phoneLocalPart } from '../src/lib/phone.js';
import { notificationText } from '../src/services/notify.js';
import { otpMessage } from '../src/services/otp.js';
import { twilioSignature } from '../src/routes/twilio.js';

describe('phone numbers', () => {
  it('normalizes Indian numbers in all common formats', () => {
    for (const input of ['9876543210', '098765 43210', '+91 98765-43210', '0091 9876543210', '919876543210', '(987) 654-3210']) {
      expect(normalizePhone(input, 'IN')?.e164, input).toBe('+919876543210');
    }
  });

  it('keeps other countries international', () => {
    const us = normalizePhone('+1 555 521 5554', 'IN')!;
    expect(us.e164).toBe('+15555215554');
    expect(phoneLocalPart(us, 'IN')).toBe('15555215554');
    expect(phoneLocalPart(normalizePhone('9876543210', 'IN')!, 'IN')).toBe('9876543210');
  });

  it('rejects garbage', () => {
    for (const input of ['', 'hello', '12', '+', '98765abc10', '1'.repeat(40)]) expect(normalizePhone(input, 'IN'), input).toBeNull();
    expect(looksLikePhone('9876543210')).toBe(true);
    expect(looksLikePhone('bob@phonemail.com')).toBe(false);
  });
});

describe('addresses and aliases', () => {
  it('normalizes addresses', () => {
    expect(normalizeAddress(' Bob@Example.COM ')).toBe('bob@example.com');
    expect(normalizeAddress('not an email')).toBeNull();
    expect(normalizeAddress('a@b')).toBeNull();
  });

  it('only allows aliases that cannot impersonate phone numbers', () => {
    expect(validateAliasLocalPart('john.doe')).toBeNull();
    expect(validateAliasLocalPart('9876543210')).not.toBeNull();
    expect(validateAliasLocalPart('postmaster')).not.toBeNull();
    expect(validateAliasLocalPart('ab')).not.toBeNull();
    expect(validateAliasLocalPart('john..doe')).not.toBeNull();
  });
});

describe('text helpers', () => {
  it('builds reply subjects without stacking prefixes', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('Re: RE: Fwd: Hello')).toBe('Re: Hello');
    expect(replySubject('')).toBe('Re:');
  });

  it('makes snippets without quoted history', () => {
    expect(makeSnippet('Thanks!\n\nOn Mon, Bob wrote:\n> old text')).toBe('Thanks!');
    expect(makeSnippet('x'.repeat(500)).length).toBeLessThanOrEqual(180);
  });

  it('strips scripts and handlers from HTML mail', () => {
    const html = sanitizeEmailHtml('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="cid:logo"></p>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('cid:logo');
  });

  it('formats the SMS notification exactly as specified', () => {
    expect(notificationText({ address: 'boss@corp.com', name: '' }, 'Meeting')).toBe('You have received an email from boss@corp.com. Subject: Meeting.');
    expect(notificationText({ address: 'a@b.com', name: 'Asha' }, '')).toBe('You have received an email from Asha (a@b.com). Subject: (no subject).');
  });

  it('appends the SMS Retriever app hash to OTP messages', () => {
    const msg = otpMessage('123456', 300, 'FA+9qCX9VSu');
    expect(msg.endsWith('\n\nFA+9qCX9VSu')).toBe(true);
    expect(Buffer.byteLength(msg)).toBeLessThanOrEqual(140);
  });
});

describe('twilio signature', () => {
  it('matches the documented Twilio example', () => {
    // Example from Twilio's security documentation.
    const sig = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    });
    expect(sig).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });
});
