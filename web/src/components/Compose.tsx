import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { MdAttachFile, MdClose, MdDeleteOutline, MdOpenInFull, MdCloseFullscreen, MdMinimize, MdInsertDriveFile } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { fileSize } from '../lib/format';
import type { Attachment, Draft, Me, MessageDetail } from '../lib/types';
import { RecipientInput, type Recipient } from './RecipientInput';
import { useUi } from './ui';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeInit {
  mode: ComposeMode;
  original?: MessageDetail;
  draft?: Draft;
  to?: string[];
}

interface ComposeApi {
  open(init: ComposeInit): void;
}

const ComposeContext = createContext<ComposeApi | null>(null);

export function useCompose(): ComposeApi {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error('useCompose outside ComposeProvider');
  return ctx;
}

const rec = (address: string, name = ''): Recipient => ({ value: address, label: name ? `${name} <${address}>` : address });

function buildInitial(init: ComposeInit, me: Me) {
  const mine = new Set([me.address, ...me.aliases]);
  const o = init.original;
  if (init.draft) {
    const d = init.draft;
    return {
      to: d.to.map((a) => rec(a)),
      cc: d.cc.map((a) => rec(a)),
      bcc: d.bcc.map((a) => rec(a)),
      subject: d.subject,
      body: d.body,
      from: d.fromAddress ?? me.address,
      replyToEntryId: d.replyToEntryId,
      attachments: d.attachments,
      draftId: d.id,
    };
  }
  const signature = me.signature ? `\n\n-- \n${me.signature}` : '';
  if (o && (init.mode === 'reply' || init.mode === 'replyAll')) {
    let to: Recipient[];
    let cc: Recipient[] = [];
    if (o.direction === 'out') {
      to = o.to.map((m) => rec(m.address, m.name));
      if (init.mode === 'replyAll') cc = o.cc.map((m) => rec(m.address, m.name));
    } else {
      to = [rec(o.from.address, o.from.name)];
      if (init.mode === 'replyAll') {
        to = [...to, ...o.to.filter((m) => !mine.has(m.address)).map((m) => rec(m.address, m.name))];
        cc = o.cc.filter((m) => !mine.has(m.address)).map((m) => rec(m.address, m.name));
      }
    }
    const dedupe = (list: Recipient[]) => list.filter((r, i) => list.findIndex((x) => x.value === r.value) === i);
    const subject = /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`.trim();
    const receivedAt = [...o.to, ...o.cc].find((m) => mine.has(m.address))?.address;
    return {
      to: dedupe(to),
      cc: dedupe(cc).filter((c) => !to.some((t) => t.value === c.value)),
      bcc: [],
      subject,
      body: signature,
      from: receivedAt ?? me.address,
      replyToEntryId: o.id,
      attachments: [],
      draftId: null,
    };
  }
  if (o && init.mode === 'forward') {
    const header = [
      '---------- Forwarded message ---------',
      `From: ${o.from.name ? `${o.from.name} <${o.from.address}>` : o.from.address}`,
      `Date: ${new Date(o.sentAt).toLocaleString()}`,
      `Subject: ${o.subject}`,
      `To: ${o.to.map((m) => m.address).join(', ')}`,
      '',
    ].join('\n');
    return {
      to: [],
      cc: [],
      bcc: [],
      subject: /^fwd?:/i.test(o.subject) ? o.subject : `Fwd: ${o.subject}`,
      body: `${signature}\n\n${header}\n${o.text}`,
      from: me.address,
      replyToEntryId: null,
      attachments: [],
      draftId: null,
    };
  }
  return {
    to: (init.to ?? []).map((a) => rec(a)),
    cc: [],
    bcc: [],
    subject: '',
    body: signature,
    from: me.address,
    replyToEntryId: null,
    attachments: [],
    draftId: null,
  };
}

function ComposeWindow({ init, me, onClose }: { init: ComposeInit; me: Me; onClose: () => void }) {
  const initial = useRef(buildInitial(init, me)).current;
  const qc = useQueryClient();
  const ui = useUi();
  const navigate = useNavigate();
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [from, setFrom] = useState(initial.from);
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments);
  const [uploading, setUploading] = useState<string[]>([]);
  const draftIdRef = useRef<string | null>(initial.draftId);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [size, setSize] = useState<'normal' | 'min' | 'max'>('normal');
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isReply = !!initial.replyToEntryId;
  const original = init.original;

  const hasContent = () =>
    to.length + cc.length + bcc.length > 0 || subject.trim() !== '' || body.replace(`\n\n-- \n${me.signature}`, '').trim() !== '' || attachments.length > 0;

  const payload = () => ({
    to: to.map((r) => r.value),
    cc: cc.map((r) => r.value),
    bcc: bcc.map((r) => r.value),
    subject,
    body,
    fromAddress: from,
    replyToEntryId: initial.replyToEntryId,
    attachmentIds: attachments.map((a) => a.id),
  });

  const saveDraft = useCallback(async () => {
    // Saves are serialized so a slow first save can never create a second draft.
    await saving.current;
    if (!dirty.current || !hasContent()) return;
    dirty.current = false;
    setStatus('Saving…');
    const run = (async () => {
      try {
        const id = draftIdRef.current;
        const saved = id ? await api.updateDraft(id, payload()) : await api.createDraft(payload());
        draftIdRef.current = saved.id;
        setStatus('Draft saved');
        void qc.invalidateQueries({ queryKey: ['drafts'] });
        void qc.invalidateQueries({ queryKey: ['counts'] });
      } catch {
        setStatus('Could not save draft');
        dirty.current = true;
      }
    })();
    saving.current = run;
    await run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, body, from, attachments]);

  useEffect(() => {
    dirty.current = true;
    const t = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, body, from, attachments]);

  // The initial render is not a user edit.
  useEffect(() => {
    dirty.current = false;
  }, []);

  const close = async () => {
    await saving.current;
    if (dirty.current && hasContent()) await saveDraft();
    if (draftIdRef.current || hasContent()) ui.toast('Draft saved');
    onClose();
  };

  const discard = async () => {
    dirty.current = false;
    try {
      await saving.current;
      if (draftIdRef.current) await api.deleteDraft(draftIdRef.current);
      else await Promise.all(attachments.map((a) => api.deleteUpload(a.id).catch(() => undefined)));
    } finally {
      void qc.invalidateQueries({ queryKey: ['drafts'] });
      void qc.invalidateQueries({ queryKey: ['counts'] });
      ui.toast('Draft discarded');
      onClose();
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploading((u) => [...u, file.name]);
      try {
        const att = await api.upload(file);
        setAttachments((a) => [...a, att]);
      } catch (err) {
        ui.toast(err instanceof ApiError ? err.message : `Could not attach ${file.name}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    if (to.length + cc.length + bcc.length === 0) {
      ui.toast('Please specify at least one recipient.');
      return;
    }
    const bad = [...to, ...cc, ...bcc].find((r) => r.invalid);
    if (bad) {
      ui.toast(`"${bad.value}" is not a valid PhoneMail number or email address.`);
      return;
    }
    if (!subject.trim() && !body.trim() && !attachments.length) {
      const ok = await ui.confirm({ title: 'Send this message without a subject or text?', confirmLabel: 'Send' });
      if (!ok) return;
    }
    setSending(true);
    dirty.current = false;
    await saving.current;
    try {
      const res = await api.send({ ...payload(), replyToEntryId: initial.replyToEntryId ?? undefined, draftId: draftIdRef.current ?? undefined });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['counts'] });
      void qc.invalidateQueries({ queryKey: ['drafts'] });
      void qc.invalidateQueries({ queryKey: ['message'] });
      onClose();
      ui.toast('Message sent', { label: 'View message', run: () => navigate(`/mail/sent/${res.entryId}`) });
    } catch (err) {
      setSending(false);
      ui.toast(err instanceof ApiError ? err.message : 'Could not send. Please try again.');
    }
  };

  const title = subject.trim() || (isReply ? 'Reply' : init.mode === 'forward' ? 'Forward' : 'New Message');
  const fromOptions = [me.address, ...me.aliases];

  return (
    <>
      {size === 'max' && <div className="compose-backdrop" onClick={() => setSize('normal')} />}
      <section className={`compose${size === 'min' ? ' min' : size === 'max' ? ' max' : ''}`} aria-label={title} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && void send()}>
        <div className="compose-head" onClick={() => setSize(size === 'min' ? 'normal' : 'min')}>
          <span className="title">{title}</span>
          <button className="icon-btn sm" aria-label="Minimize" onClick={(e) => (e.stopPropagation(), setSize(size === 'min' ? 'normal' : 'min'))}>
            <MdMinimize />
          </button>
          <button className="icon-btn sm" aria-label={size === 'max' ? 'Exit full screen' : 'Full screen'} onClick={(e) => (e.stopPropagation(), setSize(size === 'max' ? 'normal' : 'max'))}>
            {size === 'max' ? <MdCloseFullscreen /> : <MdOpenInFull />}
          </button>
          <button className="icon-btn sm" aria-label="Save & close" onClick={(e) => (e.stopPropagation(), void close())}>
            <MdClose />
          </button>
        </div>
        {size !== 'min' && (
          <>
            {fromOptions.length > 1 && (
              <div className="compose-line">
                <span className="lbl">From</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From address">
                  {fromOptions.map((a) => (
                    <option key={a} value={a}>
                      {me.displayName ? `${me.displayName} <${a}>` : a}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <RecipientInput
              label="To"
              value={to}
              onChange={setTo}
              autoFocus={!isReply && to.length === 0}
              trailing={
                <span style={{ display: 'flex', gap: 8, color: 'var(--text-3)' }}>
                  {!showCc && (
                    <button type="button" className="link-btn" style={{ color: 'var(--text-2)', fontWeight: 400 }} onClick={() => setShowCc(true)}>
                      Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button type="button" className="link-btn" style={{ color: 'var(--text-2)', fontWeight: 400 }} onClick={() => setShowBcc(true)}>
                      Bcc
                    </button>
                  )}
                </span>
              }
            />
            {showCc && <RecipientInput label="Cc" value={cc} onChange={setCc} />}
            {showBcc && <RecipientInput label="Bcc" value={bcc} onChange={setBcc} />}
            <div className="compose-line">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={500} />
            </div>
            <textarea
              className="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Message body"
              autoFocus={isReply}
            />
            {original && isReply && (
              <div className="quoted" aria-label="Replying to">
                On {new Date(original.sentAt).toLocaleString()}, {original.from.name || original.from.address} wrote:{'\n'}
                {original.text.slice(0, 1500)}
              </div>
            )}
            {(attachments.length > 0 || uploading.length > 0) && (
              <div className="files">
                {attachments.map((a) => (
                  <span className="file-chip" key={a.id}>
                    <MdInsertDriveFile />
                    <span>
                      {a.filename} ({fileSize(a.size)})
                    </span>
                    <button className="icon-btn sm" aria-label={`Remove ${a.filename}`} onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}>
                      <MdClose />
                    </button>
                  </span>
                ))}
                {uploading.map((n) => (
                  <span className="file-chip" key={`up-${n}`}>
                    <span>Uploading {n}…</span>
                  </span>
                ))}
              </div>
            )}
            <div className="compose-foot">
              <button className="btn primary" onClick={() => void send()} disabled={sending || uploading.length > 0}>
                {sending ? 'Sending…' : 'Send'}
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
              <button className="icon-btn" aria-label="Attach files" title="Attach files" onClick={() => fileRef.current?.click()}>
                <MdAttachFile />
              </button>
              <span className="status">{status}</span>
              <span className="spacer" />
              <button className="icon-btn" aria-label="Discard draft" title="Discard draft" onClick={() => void discard()}>
                <MdDeleteOutline />
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export function ComposeProvider({ me, children }: { me: Me | undefined; children: ReactNode }) {
  const [state, setState] = useState<{ key: number; init: ComposeInit } | null>(null);
  const open = useCallback((init: ComposeInit) => setState({ key: Date.now(), init }), []);
  return (
    <ComposeContext.Provider value={{ open }}>
      {children}
      {state && me && <ComposeWindow key={state.key} init={state.init} me={me} onClose={() => setState(null)} />}
    </ComposeContext.Provider>
  );
}
