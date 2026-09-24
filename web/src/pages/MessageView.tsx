import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  MdArrowBack,
  MdDeleteForever,
  MdDeleteOutline,
  MdExpandLess,
  MdExpandMore,
  MdForward,
  MdInbox,
  MdInsertDriveFile,
  MdMarkEmailUnread,
  MdOutlineReport,
  MdPictureAsPdf,
  MdImage,
  MdReply,
  MdReplyAll,
  MdRestoreFromTrash,
  MdStar,
  MdStarBorder,
} from 'react-icons/md';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { useCompose } from '../components/Compose';
import { Spinner, useUi } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { fileSize, fullDate, shortName } from '../lib/format';
import type { Me, MessageDetail } from '../lib/types';

const FOLDER_LABEL: Record<string, string> = { inbox: 'Inbox', sent: 'Sent', spam: 'Spam', trash: 'Trash' };

function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>html,body{margin:0;padding:0;font:14px/1.5 Roboto,Arial,sans-serif;color:#222;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${html}</body></html>`;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const measure = () => {
      const body = frame.contentDocument?.documentElement;
      if (body) setHeight(Math.min(20000, body.scrollHeight + 8));
    };
    const timers = [100, 400, 1200, 3000].map((ms) => window.setTimeout(measure, ms));
    frame.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      frame.removeEventListener('load', measure);
      window.removeEventListener('resize', measure);
    };
  }, [html]);

  // No allow-scripts: the email can never run code. allow-same-origin only lets us measure its height.
  return <iframe ref={ref} title="Email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} />;
}

function AttachmentIcon({ type }: { type: string }) {
  if (type === 'application/pdf') return <MdPictureAsPdf />;
  if (type.startsWith('image/')) return <MdImage style={{ color: 'var(--success)' }} />;
  return <MdInsertDriveFile style={{ color: 'var(--primary)' }} />;
}

export function MessageView() {
  const { folder = 'inbox', id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ui = useUi();
  const compose = useCompose();
  const me = qc.getQueryData<Me>(['me']);
  const [showDetails, setShowDetails] = useState(false);
  const q = params.get('q');
  const backTo = `/mail/${folder}${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  const msg = useQuery({ queryKey: ['message', id], queryFn: () => api.message(id), retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2 });

  useEffect(() => {
    const m = msg.data;
    if (m && !m.isRead) {
      void api.setFlags(m.id, { isRead: true }).then((updated) => {
        qc.setQueryData(['message', id], updated);
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['counts'] });
      });
    }
  }, [msg.data, id, qc]);

  if (msg.isLoading) return <Spinner />;
  if (!msg.data) {
    return (
      <div className="empty">
        <p>{msg.error instanceof ApiError ? msg.error.message : 'This email could not be loaded.'}</p>
        <Link className="btn" to={backTo}>
          Back to {FOLDER_LABEL[folder] ?? 'mail'}
        </Link>
      </div>
    );
  }
  const m: MessageDetail = msg.data;

  const act = async (action: Parameters<typeof api.batch>[1], toast?: string, leave = true) => {
    try {
      await api.batch([m.id], action);
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['counts'] });
      void qc.invalidateQueries({ queryKey: ['message', id] });
      if (toast) ui.toast(toast);
      if (leave) navigate(backTo);
    } catch (err) {
      ui.toast(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };

  const toggleStar = async () => {
    const updated = await api.setFlags(m.id, { isStarred: !m.isStarred });
    qc.setQueryData(['message', id], updated);
    void qc.invalidateQueries({ queryKey: ['messages'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
  };

  const others = [...m.to, ...m.cc].filter((x) => x.address !== me?.address && !me?.aliases.includes(x.address));
  const canReplyAll = m.direction === 'in' ? others.length > 0 : m.to.length + m.cc.length > 1;
  const inTrashOrSpam = m.folder === 'trash' || m.folder === 'spam';
  const recipients = [...m.to, ...m.cc].map((x) => shortName(x, me?.address)).join(', ');

  return (
    <>
      <div className="toolbar">
        <button className="icon-btn" aria-label="Back" title={`Back to ${FOLDER_LABEL[folder] ?? 'list'}`} onClick={() => navigate(backTo)}>
          <MdArrowBack />
        </button>
        {m.folder === 'trash' ? (
          <>
            <button className="icon-btn" title="Restore" aria-label="Restore" onClick={() => void act('restore', 'Message restored.')}>
              <MdRestoreFromTrash />
            </button>
            <button className="icon-btn" title="Delete forever" aria-label="Delete forever" onClick={() => void act('delete', 'Message deleted forever.')}>
              <MdDeleteForever />
            </button>
          </>
        ) : m.folder === 'spam' ? (
          <>
            <button className="btn text" onClick={() => void act('not_spam', 'Moved to Inbox. Future mail from this sender will arrive in your Inbox.')}>
              <MdInbox /> Not spam
            </button>
            <button className="icon-btn" title="Delete forever" aria-label="Delete forever" onClick={() => void act('delete', 'Message deleted forever.')}>
              <MdDeleteForever />
            </button>
          </>
        ) : (
          <>
            {m.direction === 'in' && (
              <button className="icon-btn" title="Report spam" aria-label="Report spam" onClick={() => void act('spam', 'Reported as spam. Future mail from this sender goes to Spam.')}>
                <MdOutlineReport />
              </button>
            )}
            <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => void act('trash', 'Message moved to Trash.')}>
              <MdDeleteOutline />
            </button>
          </>
        )}
        {m.direction === 'in' && (
          <button className="icon-btn" title="Mark as unread" aria-label="Mark as unread" onClick={() => void act('unread')}>
            <MdMarkEmailUnread />
          </button>
        )}
        <span className="spacer" />
      </div>

      <article className="reader">
        <h1>
          {m.subject || '(no subject)'}
          <span className="tag">{FOLDER_LABEL[m.folder]}</span>
        </h1>
        {m.replyTo && (
          <Link className="quote-card" to={`/mail/all/${m.replyTo.id}`}>
            ↩ In reply to <b>{m.replyTo.subject || '(no subject)'}</b> — {m.replyTo.snippet}
          </Link>
        )}
        <div className="msg-head">
          <Avatar name={m.from.name} address={m.from.address} size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="from">
              <strong>{m.from.name || m.from.address}</strong> {m.from.name && <span className="addr">&lt;{m.from.address}&gt;</span>}
            </div>
            <button className="link-btn to" style={{ color: 'var(--text-3)', fontWeight: 400 }} onClick={() => setShowDetails((s) => !s)} aria-expanded={showDetails}>
              to {recipients || 'undisclosed recipients'} {showDetails ? <MdExpandLess /> : <MdExpandMore />}
            </button>
            {showDetails && (
              <dl className="details">
                <dt>from:</dt>
                <dd>{m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}</dd>
                <dt>to:</dt>
                <dd>{m.to.map((x) => x.address).join(', ') || '—'}</dd>
                {m.cc.length > 0 && (
                  <>
                    <dt>cc:</dt>
                    <dd>{m.cc.map((x) => x.address).join(', ')}</dd>
                  </>
                )}
                {m.bcc.length > 0 && (
                  <>
                    <dt>bcc:</dt>
                    <dd>{m.bcc.map((x) => x.address).join(', ')}</dd>
                  </>
                )}
                <dt>date:</dt>
                <dd>{new Date(m.sentAt).toLocaleString()}</dd>
                <dt>subject:</dt>
                <dd>{m.subject || '(no subject)'}</dd>
              </dl>
            )}
          </div>
          <div className="meta">
            <span>{fullDate(m.sentAt)}</span>
            <button className={`icon-btn sm star${m.isStarred ? ' on' : ''}`} aria-label={m.isStarred ? 'Unstar' : 'Star'} onClick={() => void toggleStar()}>
              {m.isStarred ? <MdStar /> : <MdStarBorder />}
            </button>
            {m.canReply && (
              <button className="icon-btn sm" aria-label="Reply" title="Reply" onClick={() => compose.open({ mode: 'reply', original: m })}>
                <MdReply />
              </button>
            )}
          </div>
        </div>

        <div className="msg-body">{m.html ? <HtmlBody html={m.html} /> : <pre>{m.text || '(This message has no text.)'}</pre>}</div>

        {m.attachments.length > 0 && (
          <div className="attachments" aria-label="Attachments">
            {m.attachments.map((a) => (
              <a key={a.id} className="att-card" href={a.url} target="_blank" rel="noreferrer" download={a.filename} title={`Download ${a.filename}`}>
                <AttachmentIcon type={a.contentType} />
                <span style={{ minWidth: 0 }}>
                  <div className="name">{a.filename}</div>
                  <div className="size">{fileSize(a.size)}</div>
                </span>
              </a>
            ))}
          </div>
        )}

        <div className="reply-bar">
          {!inTrashOrSpam && (
            <>
              <button className="btn" disabled={!m.canReply} onClick={() => compose.open({ mode: 'reply', original: m })}>
                <MdReply /> Reply
              </button>
              {canReplyAll && (
                <button className="btn" disabled={!m.canReply} onClick={() => compose.open({ mode: 'replyAll', original: m })}>
                  <MdReplyAll /> Reply all
                </button>
              )}
            </>
          )}
          <button className="btn" onClick={() => compose.open({ mode: 'forward', original: m })}>
            <MdForward /> Forward
          </button>
          {!m.canReply && !inTrashOrSpam && <span className="hint">You already replied to this email. Each email can be replied to only once.</span>}
        </div>
      </article>
    </>
  );
}
