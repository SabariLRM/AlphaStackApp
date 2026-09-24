import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  MdArchive,
  MdAttachFile,
  MdChevronLeft,
  MdChevronRight,
  MdDeleteForever,
  MdDeleteOutline,
  MdDrafts,
  MdInbox,
  MdMarkEmailRead,
  MdMarkEmailUnread,
  MdOutlineReport,
  MdRefresh,
  MdRestoreFromTrash,
  MdStar,
  MdStarBorder,
} from 'react-icons/md';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCompose } from '../components/Compose';
import { Spinner, useUi } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { listDate } from '../lib/format';
import type { Folder, Me, MessageSummary } from '../lib/types';

const PAGE = 50;
const TITLES: Record<string, string> = { inbox: 'Inbox', starred: 'Starred', sent: 'Sent', all: 'All Mail', spam: 'Spam', trash: 'Trash' };
const FOLDERS = ['inbox', 'starred', 'sent', 'all', 'spam', 'trash'];

type Action = 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'restore' | 'spam' | 'not_spam' | 'delete';

export function MessageList() {
  const { folder = 'inbox' } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ui = useUi();
  const me = qc.getQueryData<Me>(['me']);
  const valid = FOLDERS.includes(folder);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [folder, q]);

  const list = useQuery({
    queryKey: ['messages', folder, q, page],
    queryFn: () => api.messages({ folder, q: q || undefined, offset: page * PAGE, limit: PAGE }),
    placeholderData: keepPreviousData,
    enabled: valid,
  });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
  };

  const run = async (action: Action, ids: string[], silent = false) => {
    if (!ids.length) return;
    try {
      await api.batch(ids, action);
      setSelected(new Set());
      refresh();
      if (silent) return;
      const n = ids.length === 1 ? 'Message' : `${ids.length} messages`;
      const messages: Partial<Record<Action, string>> = {
        trash: `${n} moved to Trash.`,
        spam: `${n} marked as spam. Future mail from the sender goes to Spam.`,
        not_spam: `${n} moved to Inbox.`,
        restore: `${n} restored.`,
        delete: `${n} deleted forever.`,
      };
      if (messages[action]) {
        ui.toast(messages[action]!, action === 'trash' ? { label: 'Undo', run: () => void run('restore', ids, true) } : undefined);
      }
    } catch (err) {
      ui.toast(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && items.every((m) => selected.has(m.id));
  const ids = [...selected];
  const selectedItems = items.filter((m) => selected.has(m.id));
  const anyUnread = selectedItems.some((m) => !m.isRead);

  const emptyFolder = async (which: 'trash' | 'spam') => {
    const ok = await ui.confirm({
      title: `Empty ${which === 'trash' ? 'Trash' : 'Spam'}?`,
      body: <p>All messages in {which === 'trash' ? 'Trash' : 'Spam'} will be deleted forever.</p>,
      confirmLabel: 'Empty now',
      danger: true,
    });
    if (!ok) return;
    const res = await api.emptyFolder(which);
    refresh();
    ui.toast(`${res.deleted} message${res.deleted === 1 ? '' : 's'} deleted forever.`);
  };

  if (!valid) return <div className="empty">Unknown folder.</div>;

  return (
    <>
      <div className="toolbar">
        <input
          type="checkbox"
          className="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)))}
        />
        {selected.size === 0 ? (
          <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={refresh}>
            <MdRefresh />
          </button>
        ) : (
          <SelectionActions folder={folder as Folder} anyUnread={anyUnread} onAction={(a) => void run(a, ids)} />
        )}
        <span className="spacer" />
        {total > 0 && (
          <span className="range">
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          </span>
        )}
        <button className="icon-btn" aria-label="Newer" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          <MdChevronLeft />
        </button>
        <button className="icon-btn" aria-label="Older" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
          <MdChevronRight />
        </button>
      </div>

      {(folder === 'trash' || folder === 'spam') && total > 0 && (
        <div className="banner">
          {folder === 'trash' ? 'Messages that have been in Trash more than 30 days will be deleted automatically.' : 'Messages from senders you reported as spam land here.'}
          <button className="link-btn" onClick={() => void emptyFolder(folder as 'trash' | 'spam')}>
            Empty {folder === 'trash' ? 'Trash' : 'Spam'} now
          </button>
        </div>
      )}
      {q && <div className="banner">Search results for “{q}” in All Mail</div>}

      <div className="list" role="list" aria-label={TITLES[folder]}>
        {list.isLoading && <Spinner />}
        {list.isError && <div className="empty">Could not load messages. <button className="btn" onClick={() => void list.refetch()}>Retry</button></div>}
        {list.isSuccess && items.length === 0 && <EmptyFolder folder={folder} searching={!!q} />}
        {items.map((m) => (
          <Row
            key={m.id}
            m={m}
            me={me?.address}
            folder={folder}
            selected={selected.has(m.id)}
            onToggle={() => toggle(m.id)}
            onOpen={() => navigate(`/mail/${folder}/${m.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
            onAction={(a) => void run(a, [m.id], a === 'read' || a === 'unread' || a === 'star' || a === 'unstar')}
          />
        ))}
      </div>
    </>
  );
}

function SelectionActions({ folder, anyUnread, onAction }: { folder: Folder; anyUnread: boolean; onAction: (a: Action) => void }) {
  return (
    <>
      {folder === 'trash' ? (
        <>
          <button className="icon-btn" title="Restore" aria-label="Restore" onClick={() => onAction('restore')}>
            <MdRestoreFromTrash />
          </button>
          <button className="icon-btn" title="Delete forever" aria-label="Delete forever" onClick={() => onAction('delete')}>
            <MdDeleteForever />
          </button>
        </>
      ) : folder === 'spam' ? (
        <>
          <button className="btn text" onClick={() => onAction('not_spam')}>
            Not spam
          </button>
          <button className="icon-btn" title="Delete forever" aria-label="Delete forever" onClick={() => onAction('delete')}>
            <MdDeleteForever />
          </button>
        </>
      ) : (
        <>
          <button className="icon-btn" title="Report spam" aria-label="Report spam" onClick={() => onAction('spam')}>
            <MdOutlineReport />
          </button>
          <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => onAction('trash')}>
            <MdDeleteOutline />
          </button>
        </>
      )}
      <button className="icon-btn" title={anyUnread ? 'Mark as read' : 'Mark as unread'} aria-label={anyUnread ? 'Mark as read' : 'Mark as unread'} onClick={() => onAction(anyUnread ? 'read' : 'unread')}>
        {anyUnread ? <MdMarkEmailRead /> : <MdMarkEmailUnread />}
      </button>
    </>
  );
}

function Row({
  m,
  me,
  folder,
  selected,
  onToggle,
  onOpen,
  onAction,
}: {
  m: MessageSummary;
  me?: string;
  folder: string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAction: (a: Action) => void;
}) {
  const who =
    m.direction === 'out'
      ? `To: ${[...m.to, ...m.cc].map((x) => (x.address === me ? 'me' : x.name || x.address.split('@')[0])).join(', ') || '(no recipients)'}`
      : m.from.name || m.from.address;
  return (
    <div
      role="listitem"
      className={`row${m.isRead ? '' : ' unread'}${selected ? ' selected' : ''}`}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="checkbox" aria-label="Select" checked={selected} onChange={onToggle} />
      </span>
      <span className="star-cell" onClick={(e) => e.stopPropagation()}>
        <button className={`icon-btn sm star${m.isStarred ? ' on' : ''}`} aria-label={m.isStarred ? 'Starred' : 'Not starred'} onClick={() => onAction(m.isStarred ? 'unstar' : 'star')}>
          {m.isStarred ? <MdStar /> : <MdStarBorder />}
        </button>
      </span>
      <span className="who" title={m.direction === 'out' ? undefined : m.from.address}>
        {who}
      </span>
      <span className="what">
        {folder === 'all' && m.folder === 'sent' && <span className="tag">Sent</span>}
        {m.subject || '(no subject)'}
        {m.snippet && <span className="snippet"> - {m.snippet}</span>}
      </span>
      <span className="when">
        {m.hasAttachments && <MdAttachFile aria-label="Has attachment" />}
        <span className="date">{listDate(m.sentAt)}</span>
        <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
          {folder === 'trash' ? (
            <button className="icon-btn sm" title="Restore" aria-label="Restore" onClick={() => onAction('restore')}>
              <MdRestoreFromTrash />
            </button>
          ) : folder === 'spam' ? (
            <button className="icon-btn sm" title="Not spam" aria-label="Not spam" onClick={() => onAction('not_spam')}>
              <MdInbox />
            </button>
          ) : (
            <button className="icon-btn sm" title="Delete" aria-label="Delete" onClick={() => onAction('trash')}>
              <MdDeleteOutline />
            </button>
          )}
          <button className="icon-btn sm" title={m.isRead ? 'Mark as unread' : 'Mark as read'} aria-label={m.isRead ? 'Mark as unread' : 'Mark as read'} onClick={() => onAction(m.isRead ? 'unread' : 'read')}>
            {m.isRead ? <MdMarkEmailUnread /> : <MdDrafts />}
          </button>
        </span>
      </span>
    </div>
  );
}

function EmptyFolder({ folder, searching }: { folder: string; searching: boolean }) {
  const compose = useCompose();
  if (searching) return <div className="empty">No messages matched your search.</div>;
  const text: Record<string, string> = {
    inbox: 'Your inbox is empty. Share your PhoneMail address to start receiving emails!',
    starred: 'No starred messages. Stars let you give messages a special status to make them easier to find.',
    sent: 'No sent messages.',
    all: 'No messages yet.',
    spam: 'Hooray, no spam here!',
    trash: 'No conversations in Trash.',
  };
  return (
    <div className="empty">
      <MdArchive />
      <p>{text[folder]}</p>
      {folder === 'inbox' || folder === 'sent' ? (
        <button className="btn" onClick={() => compose.open({ mode: 'new' })}>
          Compose
        </button>
      ) : null}
    </div>
  );
}
