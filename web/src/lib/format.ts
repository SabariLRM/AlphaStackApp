import type { Mailbox } from './types';

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Gmail-style list dates: time today, "Sep 21" this year, "21/09/2024" otherwise. */
export function listDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString();
}

export function fullDate(iso: string): string {
  const d = new Date(iso);
  const ago = relative(d);
  const abs = d.toLocaleString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return ago ? `${abs} (${ago})` : abs;
}

function relative(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return '';
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const displayName = (m: Mailbox) => m.name || m.address;

export const shortName = (m: Mailbox, me?: string) => {
  if (me && m.address === me) return 'me';
  if (m.name) return m.name.split(/\s+/)[0]!;
  return m.address.split('@')[0]!;
};

export function initials(text: string): string {
  const clean = text.replace(/@.*/, '').trim();
  if (!clean) return '?';
  if (/^\+?\d/.test(clean)) return '#';
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

const PALETTE = ['#1a73e8', '#e8710a', '#188038', '#a142f4', '#d93025', '#007b83', '#c5221f', '#9334e6', '#1e8e3e', '#f29900'];
export function colorFor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
