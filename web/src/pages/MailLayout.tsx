import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  MdClose,
  MdCreate,
  MdDeleteOutline,
  MdDrafts,
  MdHelpOutline,
  MdInbox,
  MdLogout,
  MdMail,
  MdMenu,
  MdOutlineReport,
  MdSearch,
  MdSend,
  MdSettings,
  MdStarBorder,
  MdTune,
} from 'react-icons/md';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ComposeProvider, useCompose } from '../components/Compose';
import { Spinner, useUi } from '../components/ui';
import { api, ApiError, setUnauthorizedHandler } from '../lib/api';
import { prettyPhone } from '../lib/phone';
import { useRealtime } from '../lib/realtime';
import type { Me } from '../lib/types';

const NAV = [
  { to: '/mail/inbox', label: 'Inbox', icon: MdInbox, count: 'inboxUnread' as const },
  { to: '/mail/starred', label: 'Starred', icon: MdStarBorder },
  { to: '/mail/sent', label: 'Sent', icon: MdSend },
  { to: '/mail/drafts', label: 'Drafts', icon: MdDrafts, count: 'drafts' as const },
  { to: '/mail/all', label: 'All Mail', icon: MdMail },
  { to: '/mail/spam', label: 'Spam', icon: MdOutlineReport, count: 'spamUnread' as const },
  { to: '/mail/trash', label: 'Trash', icon: MdDeleteOutline },
];

export function MailLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 60_000 });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear();
      navigate('/login', { replace: true });
    });
  }, [qc, navigate]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) navigate('/login', { replace: true });
  }, [me.error, navigate]);

  if (me.isLoading) return <Spinner />;
  if (!me.data) {
    return (
      <div className="center">
        <div className="empty">
          <p>{me.error instanceof ApiError ? me.error.message : 'Could not load your account.'}</p>
          <button className="btn" onClick={() => void me.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return (
    <ComposeProvider me={me.data}>
      <Shell me={me.data} />
    </ComposeProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const qc = useQueryClient();
  const ui = useUi();
  const compose = useCompose();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pm.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [q, setQ] = useState(params.get('q') ?? '');
  const accountRef = useRef<HTMLDivElement>(null);
  const counts = useQuery({ queryKey: ['counts'], queryFn: api.counts, refetchInterval: 60_000 });

  const onNewMail = useCallback(() => {
    void qc.fetchQuery({ queryKey: ['counts'], queryFn: api.counts });
  }, [qc]);
  useRealtime(true, onNewMail);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  useEffect(() => {
    const unread = counts.data?.inboxUnread ?? 0;
    document.title = unread ? `Inbox (${unread}) - ${me.address} - PhoneMail` : `${me.address} - PhoneMail`;
  }, [counts.data?.inboxUnread, me.address]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [accountOpen]);

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMobileOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem('pm.sidebar', c ? 'open' : 'collapsed');
      return !c;
    });
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    navigate(value ? `/mail/all?q=${encodeURIComponent(value)}` : '/mail/inbox');
  };

  const signOut = async () => {
    try {
      await api.logout();
    } finally {
      qc.clear();
      navigate('/login', { replace: true });
      ui.toast('You have been signed out.');
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn" aria-label="Main menu" onClick={toggleSidebar}>
          <MdMenu />
        </button>
        <Link to="/mail/inbox" className="brand" aria-label="PhoneMail inbox">
          <img src="/favicon.svg" alt="" />
          <span>PhoneMail</span>
        </Link>
        <form className="search" role="search" onSubmit={onSearch}>
          <button className="icon-btn" aria-label="Search" type="submit">
            <MdSearch />
          </button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" aria-label="Search mail" />
          {q && (
            <button className="icon-btn" type="button" aria-label="Clear search" onClick={() => (setQ(''), navigate('/mail/inbox'))}>
              <MdClose />
            </button>
          )}
          <button className="icon-btn hide-sm" type="button" aria-label="Search options" title="Search in all mail" onClick={onSearch}>
            <MdTune />
          </button>
        </form>
        <span className="spacer" />
        <Link className="icon-btn hide-sm" to="/terms" aria-label="Help and terms" title="Help">
          <MdHelpOutline />
        </Link>
        <Link className="icon-btn" to="/settings/general" aria-label="Settings" title="Settings">
          <MdSettings />
        </Link>
        <div ref={accountRef} style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Account" aria-expanded={accountOpen} onClick={() => setAccountOpen((o) => !o)}>
            <Avatar name={me.displayName} address={me.address} src={me.avatarUrl} size={32} />
          </button>
          {accountOpen && (
            <div className="account-card" role="dialog" aria-label="Account">
              <div className="addr">{me.address}</div>
              <Avatar name={me.displayName} address={me.address} src={me.avatarUrl} size={80} />
              <div className="hello">Hi, {me.displayName || prettyPhone(me.phone)}!</div>
              <div className="actions">
                <button className="btn" onClick={() => (setAccountOpen(false), navigate('/settings/profile'))}>
                  Manage your PhoneMail account
                </button>
                <button className="btn text" onClick={() => void signOut()}>
                  <MdLogout /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className={`body${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <nav className="sidebar" aria-label="Folders">
          <button className="compose-btn" onClick={() => compose.open({ mode: 'new' })}>
            <MdCreate />
            <span>Compose</span>
          </button>
          {NAV.map((item) => {
            const n = item.count ? counts.data?.[item.count] ?? 0 : 0;
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive && !params.get('q') ? ' active' : ''}`} title={item.label}>
                <item.icon />
                <span className="label">{item.label}</span>
                {n > 0 && <span className="count">{n}</span>}
              </NavLink>
            );
          })}
          <div className="sidebar-foot">
            {me.address}
            <br />
            {me.hasMobileApp ? 'Using the PhoneMail app' : me.smsNotifications ? 'SMS alerts are on for new mail' : 'SMS alerts are off'}
          </div>
        </nav>
        <main className="panel">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
