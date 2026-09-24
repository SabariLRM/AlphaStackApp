import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MdComputer, MdDeleteOutline, MdPhoneAndroid } from 'react-icons/md';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Spinner, useUi } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { prettyPhone } from '../lib/phone';
import type { AppConfig, Me } from '../lib/types';

const TABS = [
  ['general', 'General'],
  ['profile', 'Profile'],
  ['aliases', 'Alias IDs'],
  ['security', 'Devices & security'],
  ['blocked', 'Blocked senders'],
  ['account', 'Account'],
] as const;

const LANGUAGES = [
  ['en', 'English'],
  ['hi', 'हिन्दी (Hindi)'],
  ['ta', 'தமிழ் (Tamil)'],
  ['te', 'తెలుగు (Telugu)'],
];

const SOURCE_LABEL: Record<Me['registrationSource'], string> = {
  mobile: 'the Android app',
  web: 'the web client',
  portal: 'the registration portal',
  ivr: 'a phone call (IVR)',
  sms: 'SMS',
};

export function SettingsPage() {
  const { tab = 'general' } = useParams();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  if (!me.data || !config.data) return <Spinner />;
  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Settings</h1>
      </div>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([key, label]) => (
          <NavLink key={key} to={`/settings/${key}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="settings-body">
        {tab === 'general' && <General me={me.data} />}
        {tab === 'profile' && <Profile me={me.data} />}
        {tab === 'aliases' && <Aliases me={me.data} config={config.data} />}
        {tab === 'security' && <Security />}
        {tab === 'blocked' && <Blocked />}
        {tab === 'account' && <Account me={me.data} />}
      </div>
    </div>
  );
}

function useSaveMe() {
  const qc = useQueryClient();
  const ui = useUi();
  return useMutation({
    mutationFn: api.updateMe,
    onSuccess: (me) => {
      qc.setQueryData(['me'], me);
      ui.toast('Settings saved.');
    },
    onError: (err) => ui.toast(err instanceof ApiError ? err.message : 'Could not save settings.'),
  });
}

function General({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const save = useSaveMe();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [language, setLanguage] = useState(me.language);
  const [signature, setSignature] = useState(me.signature);
  const [sms, setSms] = useState(me.smsNotifications);
  const welcome = params.get('welcome') === '1';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ displayName: displayName.trim(), language, signature, smsNotifications: sms });
  };

  return (
    <form onSubmit={submit}>
      {welcome && (
        <div className="dev-note" style={{ marginTop: 0, marginBottom: 8 }}>
          🎉 Welcome to PhoneMail! Your address is <b>{me.address}</b>. Add your name so people know who is emailing them.
        </div>
      )}
      <div className="setting">
        <div className="name">
          Your name<small>Shown to people you email.</small>
        </div>
        <input className="input" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Asha Kumar" />
      </div>
      <div className="setting">
        <div className="name">
          Language<small>Used by the PhoneMail Android app on your devices.</small>
        </div>
        <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="setting">
        <div className="name">
          SMS notifications
          <small>An SMS like “You have received an email from &lt;Sender&gt;. Subject: &lt;Subject&gt;.” Sent only while you don't use the PhoneMail app.</small>
        </div>
        <div>
          <label className="switch">
            <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
            {sms ? 'On' : 'Off'} — alerts go to {prettyPhone(me.phone)}
          </label>
          {me.hasMobileApp && <p className="hint">You're using the PhoneMail app, so the app notifies you instead of SMS.</p>}
        </div>
      </div>
      <div className="setting">
        <div className="name">
          Signature<small>Appended to messages you compose.</small>
        </div>
        <textarea className="textarea" value={signature} maxLength={2000} onChange={(e) => setSignature(e.target.value)} placeholder="Cheers,&#10;Asha" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button className="btn primary" disabled={save.isPending}>
          Save changes
        </button>
      </div>
    </form>
  );
}

async function resizeImage(file: File, max = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.88));
}

function Profile({ me }: { me: Me }) {
  const qc = useQueryClient();
  const ui = useUi();
  const save = useSaveMe();
  const [about, setAbout] = useState(me.about);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await resizeImage(file);
      qc.setQueryData(['me'], await api.uploadAvatar(blob));
      ui.toast('Profile photo updated.');
    } catch (err) {
      ui.toast(err instanceof ApiError ? err.message : 'That image could not be used.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    qc.setQueryData(['me'], await api.removeAvatar());
    ui.toast('Profile photo removed.');
  };

  return (
    <>
      <div className="setting">
        <div className="name">
          Profile photo<small>Visible to people you email, in the app and on the web.</small>
        </div>
        <div className="profile-photo">
          <Avatar name={me.displayName} address={me.address} src={me.avatarUrl} size={96} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : me.avatarUrl ? 'Change photo' : 'Add photo'}
          </button>
          {me.avatarUrl && (
            <button className="btn text danger" onClick={() => void remove()}>
              Remove
            </button>
          )}
        </div>
      </div>
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ about: about.trim() });
        }}
      >
        <div className="name">
          About<small>A short status, like on WhatsApp.</small>
        </div>
        <div className="inline-form">
          <input className="input" value={about} maxLength={140} onChange={(e) => setAbout(e.target.value)} placeholder="Hey there! I am using PhoneMail." />
          <button className="btn primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
      <div className="setting">
        <div className="name">Phone number</div>
        <div>{prettyPhone(me.phone)}</div>
      </div>
      <div className="setting">
        <div className="name">Email address</div>
        <div>
          <b>{me.address}</b>
          <p className="hint">Created {new Date(me.createdAt).toLocaleDateString()} via {SOURCE_LABEL[me.registrationSource]}.</p>
        </div>
      </div>
    </>
  );
}

function Aliases({ me, config }: { me: Me; config: AppConfig }) {
  const qc = useQueryClient();
  const ui = useUi();
  const [alias, setAlias] = useState('');
  const [error, setError] = useState('');
  const add = useMutation({
    mutationFn: () => api.addAlias(alias.trim()),
    onSuccess: (res) => {
      setAlias('');
      setError('');
      void qc.invalidateQueries({ queryKey: ['me'] });
      ui.toast(`${res.address} is now yours.`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add alias.'),
  });

  const remove = async (address: string) => {
    const ok = await ui.confirm({
      title: 'Remove alias?',
      body: <p>Mail sent to {address} will no longer reach you, and someone else may claim it.</p>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await api.removeAlias(address);
    void qc.invalidateQueries({ queryKey: ['me'] });
    ui.toast('Alias removed.');
  };

  return (
    <>
      <p className="hint" style={{ fontSize: 14, marginTop: 0 }}>
        Alias IDs are extra addresses for your mailbox, like <b>asha@{config.mailDomain}</b>. Mail to any alias lands in the same chats as your phone
        address, and you can choose an alias as the “From” address when composing. You can have up to 5.
      </p>
      <div className="list-card" style={{ marginBottom: 20 }}>
        <div className="item">
          <div className="grow">
            <b>{me.address}</b>
            <small>Primary address (your phone number)</small>
          </div>
          <span className="badge">Primary</span>
        </div>
        {me.aliases.map((a) => (
          <div className="item" key={a}>
            <div className="grow">
              <b>{a}</b>
              <small>Alias</small>
            </div>
            <button className="icon-btn" aria-label={`Remove ${a}`} onClick={() => void remove(a)}>
              <MdDeleteOutline />
            </button>
          </div>
        ))}
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (alias.trim()) add.mutate();
        }}
      >
        <div className="suffix-input">
          <input value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase())} placeholder="new alias" aria-label="New alias" maxLength={32} disabled={me.aliases.length >= 5} />
          <span>@{config.mailDomain}</span>
        </div>
        <button className="btn primary" disabled={add.isPending || !alias.trim() || me.aliases.length >= 5}>
          Add alias
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

function Security() {
  const qc = useQueryClient();
  const ui = useUi();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const revoke = async (id: string) => {
    await api.revokeSession(id);
    void qc.invalidateQueries({ queryKey: ['sessions'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
    ui.toast('Device signed out.');
  };
  if (!sessions.data) return <Spinner />;
  return (
    <>
      <p className="hint" style={{ fontSize: 14, marginTop: 0 }}>
        These devices are signed in to your PhoneMail account. Sign out any device you don't recognise — it will need a new OTP to get back in.
      </p>
      <div className="list-card">
        {sessions.data.items.map((s) => (
          <div className="item" key={s.id}>
            {s.client === 'mobile' ? <MdPhoneAndroid size={28} /> : <MdComputer size={28} />}
            <div className="grow">
              <b>{s.deviceName || (s.client === 'mobile' ? 'Android phone' : 'Web browser')}</b> {s.current && <span className="badge">This device</span>}
              <small>
                {s.client === 'mobile' ? 'PhoneMail app' : 'Web'} · last active {new Date(s.lastSeenAt).toLocaleString()} {s.ip ? `· ${s.ip}` : ''}
              </small>
            </div>
            {!s.current && (
              <button className="btn text danger" onClick={() => void revoke(s.id)}>
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Blocked() {
  const qc = useQueryClient();
  const ui = useUi();
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  if (!blocked.data) return <Spinner />;
  return (
    <>
      <p className="hint" style={{ fontSize: 14, marginTop: 0 }}>
        When you report an email as spam, its sender is added here and their future emails go straight to Spam.
      </p>
      {blocked.data.items.length === 0 ? (
        <div className="empty" style={{ padding: 32 }}>
          No blocked senders.
        </div>
      ) : (
        <div className="list-card">
          {blocked.data.items.map((b) => (
            <div className="item" key={b.address}>
              <div className="grow">
                <b>{b.address}</b>
                <small>Blocked {new Date(b.createdAt).toLocaleDateString()}</small>
              </div>
              <button
                className="btn text"
                onClick={async () => {
                  await api.unblock(b.address);
                  void qc.invalidateQueries({ queryKey: ['blocked'] });
                  ui.toast(`${b.address} unblocked.`);
                }}
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Account({ me }: { me: Me }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmPhone, setConfirmPhone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setError(''), [confirmPhone]);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await ui.confirm({
      title: 'Delete your PhoneMail account?',
      body: <p>All your emails, chats, aliases and settings will be permanently deleted. This cannot be undone.</p>,
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteAccount(confirmPhone);
      qc.clear();
      navigate('/login', { replace: true });
      ui.toast('Your account has been deleted.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the account.');
    }
  };

  return (
    <form className="setting" onSubmit={remove}>
      <div className="name">
        Delete account<small>Type your phone number ({prettyPhone(me.phone)}) to confirm.</small>
      </div>
      <div>
        <div className="inline-form">
          <input className="input" value={confirmPhone} onChange={(e) => setConfirmPhone(e.target.value)} placeholder="Your phone number" inputMode="tel" />
          <button className="btn danger" disabled={!confirmPhone.trim()}>
            Delete account
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </form>
  );
}
