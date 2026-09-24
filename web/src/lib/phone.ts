import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface Country {
  code: CountryCode;
  name: string;
  dial: string;
}

let cache: Country[] | null = null;

/** Every country libphonenumber knows, with localized names, sorted by name. */
export function countries(): Country[] {
  if (cache) return cache;
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }) : null;
  cache = getCountries()
    .map((code) => ({ code, name: names?.of(code) ?? code, dial: getCountryCallingCode(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export const formatAsYouType = (value: string, country: CountryCode) => new AsYouType(country).input(value);

/** Returns E.164 for a national number in the given country, or null if it cannot be a real number. */
export function toE164(national: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(national, country);
  return parsed && parsed.isPossible() ? parsed.number : null;
}

export function prettyPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
