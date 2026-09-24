export interface Mailbox {
  address: string;
  name: string;
}

// Deliberately conservative: dot-atom local part (plus a few common symbols) and a hostname domain.
const ADDRESS_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeAddress(input: string): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !ADDRESS_RE.test(value)) return null;
  const local = value.slice(0, value.lastIndexOf('@'));
  if (local.length > 64) return null;
  return value;
}

export const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();
export const localPartOf = (address: string) => address.slice(0, address.lastIndexOf('@'));

export function uniqueAddresses(list: string[]): string[] {
  return [...new Set(list.map((a) => a.toLowerCase()))];
}

/** RFC 5322 display form: "Name" <addr> */
export function formatMailbox(m: Mailbox): string {
  if (!m.name) return m.address;
  const escaped = m.name.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ');
  return `"${escaped}" <${m.address}>`;
}

export const ALIAS_RE = /^[a-z][a-z0-9._-]{2,31}$/;

export const RESERVED_LOCAL_PARTS = new Set([
  'abuse', 'admin', 'administrator', 'help', 'hostmaster', 'info', 'mailer-daemon', 'noreply', 'no-reply',
  'phonemail', 'postmaster', 'root', 'security', 'support', 'system', 'webmaster',
]);

export function validateAliasLocalPart(localPart: string): string | null {
  const value = localPart.trim().toLowerCase();
  if (!ALIAS_RE.test(value)) {
    return 'Alias must be 3-32 characters, start with a letter and contain only letters, digits, dots, dashes or underscores.';
  }
  if (/[._-]{2}/.test(value) || /[._-]$/.test(value)) return 'Alias cannot end with or repeat dots, dashes or underscores.';
  if (RESERVED_LOCAL_PARTS.has(value)) return 'That alias is reserved.';
  return null;
}
