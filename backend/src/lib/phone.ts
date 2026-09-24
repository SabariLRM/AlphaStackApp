import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export interface NormalizedPhone {
  /** E.164, e.g. +919876543210 */
  e164: string;
  countryCallingCode: string;
  nationalNumber: string;
  country?: string;
}

/**
 * Parses user input ("98765 43210", "+91-98765-43210", "0091 98765 43210", "919876543210") into E.164.
 * Numbers without an international prefix are interpreted in `defaultCountry`.
 * We only require the number to be *possible* (right length for the country) rather than strictly
 * valid, so emulator/test numbers such as +1 555-521-5554 still work. Ownership is proven by OTP anyway.
 */
export function normalizePhone(input: string, defaultCountry: string): NormalizedPhone | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw || raw.length > 32) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  raw = raw.replace(/[\s().-]/g, '');
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (!/^\+?\d{4,16}$/.test(raw)) return null;

  const tryParse = (value: string, country?: CountryCode) => {
    const parsed = parsePhoneNumberFromString(value, country);
    return parsed && parsed.isPossible() ? parsed : undefined;
  };

  let parsed = raw.startsWith('+') ? tryParse(raw) : tryParse(raw, defaultCountry as CountryCode);
  // "919876543210" typed without the plus: accept it if it starts with the default calling code.
  if (!parsed && !raw.startsWith('+')) {
    const cc = safeCallingCode(defaultCountry);
    if (cc && raw.startsWith(cc)) parsed = tryParse(`+${raw}`);
  }
  if (!parsed) return null;
  return {
    e164: parsed.number,
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
    country: parsed.country,
  };
}

export function safeCallingCode(country: string): string | undefined {
  try {
    return getCountryCallingCode(country as CountryCode);
  } catch {
    return undefined;
  }
}

/**
 * The mailbox local part for a phone number: the plain national number for the deployment's home
 * country (9876543210@phonemail.com), full international digits for everyone else (14155550100@...).
 */
export function phoneLocalPart(phone: NormalizedPhone, defaultCountry: string): string {
  const homeCode = safeCallingCode(defaultCountry);
  if (homeCode && phone.countryCallingCode === homeCode) return phone.nationalNumber;
  return phone.e164.slice(1);
}

export function looksLikePhone(input: string): boolean {
  const digits = input.replace(/[\s().+-]/g, '');
  return /^\d{6,16}$/.test(digits) && /^[+\d\s().-]+$/.test(input.trim());
}
