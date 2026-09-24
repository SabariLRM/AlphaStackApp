import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MdClose, MdLock } from 'react-icons/md';
import { api, type LookupResult } from '../lib/api';
import { Avatar } from './Avatar';

export interface Recipient {
  value: string;
  label: string;
  invalid?: boolean;
}

const looksLikePhone = (v: string) => /^[+\d\s().-]{6,}$/.test(v) && v.replace(/\D/g, '').length >= 6;
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function resolveRecipient(raw: string): Promise<Recipient> {
  const v = raw.trim();
  if (looksLikeEmail(v)) return { value: v.toLowerCase(), label: v.toLowerCase() };
  if (looksLikePhone(v)) {
    try {
      const r = await api.lookup(v);
      if (r.registered && r.address) return { value: r.address, label: r.name ? `${r.name} <${r.address}>` : r.address };
    } catch {
      /* fall through */
    }
    return { value: v, label: `${v} (not on PhoneMail)`, invalid: true };
  }
  return { value: v, label: v, invalid: true };
}

interface Props {
  label: string;
  value: Recipient[];
  onChange?: (next: Recipient[]) => void;
  locked?: boolean;
  autoFocus?: boolean;
  trailing?: ReactNode;
}

export function RecipientInput({ label, value, onChange, locked, autoFocus, trailing }: Props) {
  const [text, setText] = useState('');
  const [suggestion, setSuggestion] = useState<LookupResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = text.trim();
    setSuggestion(null);
    if (!v || !(looksLikePhone(v) || looksLikeEmail(v))) return;
    const t = window.setTimeout(() => {
      api
        .lookup(v)
        .then((r) => {
          if (r.found && r.address) setSuggestion(r);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [text]);

  const add = async (raw: string) => {
    const parts = raw.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length || !onChange) return;
    const resolved = await Promise.all(parts.map(resolveRecipient));
    const next = [...value];
    for (const r of resolved) if (!next.some((n) => n.value === r.value)) next.push(r);
    onChange(next);
    setText('');
    setSuggestion(null);
  };

  const pickSuggestion = () => {
    if (!suggestion?.address || !onChange) return;
    if (!value.some((v) => v.value === suggestion.address)) {
      onChange([...value, { value: suggestion.address, label: suggestion.name ? `${suggestion.name} <${suggestion.address}>` : suggestion.address }]);
    }
    setText('');
    setSuggestion(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && text.trim())) {
      e.preventDefault();
      if (suggestion) pickSuggestion();
      else void add(text);
    } else if (e.key === 'Backspace' && !text && value.length && onChange) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="compose-line" style={{ position: 'relative' }} onClick={() => inputRef.current?.focus()}>
      <span className="lbl">{label}</span>
      <div className="chips">
        {value.map((r) => (
          <span key={r.value} className={`chip${r.invalid ? ' bad' : ''}${locked ? ' locked' : ''}`} title={r.invalid ? 'This recipient is not valid' : r.value}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            {!locked && (
              <button type="button" aria-label={`Remove ${r.label}`} onClick={() => onChange?.(value.filter((v) => v.value !== r.value))}>
                <MdClose />
              </button>
            )}
          </span>
        ))}
        {!locked && (
          <input
            ref={inputRef}
            value={text}
            autoFocus={autoFocus}
            aria-label={`${label} recipients`}
            placeholder={value.length ? '' : 'Phone number or email'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => text.trim() && void add(text)}
          />
        )}
      </div>
      {locked && <MdLock className="lock" title="Recipients are fixed for this chat" />}
      {trailing}
      {suggestion?.address && (
        <div className="suggest" style={{ left: 40, top: '100%' }}>
          <button type="button" className="active" onMouseDown={(e) => e.preventDefault()} onClick={pickSuggestion}>
            <Avatar name={suggestion.name} address={suggestion.address} src={suggestion.avatarUrl} size={32} />
            <span>
              {suggestion.name || suggestion.address}
              <small>{suggestion.registered ? suggestion.address : 'External address'}</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
