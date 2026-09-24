import type { AppConfig, Attachment, Counts, Draft, Me, MessageDetail, MessageSummary, SessionInfo } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'PhoneMail' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach PhoneMail. Check your connection.');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export interface SendPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  fromAddress?: string;
  replyToEntryId?: string;
  attachmentIds?: string[];
  draftId?: string;
}

export interface DraftPayload {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  fromAddress?: string | null;
  replyToEntryId?: string | null;
  attachmentIds?: string[];
}

export interface LookupResult {
  found: boolean;
  registered: boolean;
  address: string | null;
  phone: string | null;
  name: string;
  avatarUrl: string | null;
}

export const api = {
  config: () => request<AppConfig>('GET', '/config'),
  requestOtp: (phone: string) => request<{ phone: string; expiresIn: number; resendIn: number }>('POST', '/auth/otp/request', { phone }),
  verifyOtp: (phone: string, code: string) => request<{ user: Me; isNewUser: boolean }>('POST', '/auth/otp/verify', { phone, code, client: 'web' }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  me: () => request<Me>('GET', '/me'),
  updateMe: (patch: Partial<Pick<Me, 'displayName' | 'about' | 'language' | 'signature' | 'smsNotifications'>>) => request<Me>('PATCH', '/me', patch),
  uploadAvatar: (file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'avatar.jpg');
    return request<Me>('PUT', '/me/avatar', form);
  },
  removeAvatar: () => request<Me>('DELETE', '/me/avatar'),
  deleteAccount: (confirmPhone: string) => request<{ ok: true }>('DELETE', '/me', { confirmPhone }),
  addAlias: (alias: string) => request<{ address: string }>('POST', '/me/aliases', { alias }),
  removeAlias: (address: string) => request<{ ok: true }>('DELETE', `/me/aliases/${encodeURIComponent(address)}`),
  sessions: () => request<{ items: SessionInfo[] }>('GET', '/me/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/me/sessions/${id}`),
  blocked: () => request<{ items: { address: string; createdAt: string }[] }>('GET', '/me/blocked'),
  unblock: (address: string) => request<{ ok: true }>('DELETE', `/me/blocked/${encodeURIComponent(address)}`),

  messages: (params: { folder: string; q?: string; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams({ folder: params.folder, offset: String(params.offset ?? 0), limit: String(params.limit ?? 50) });
    if (params.q) qs.set('q', params.q);
    return request<{ items: MessageSummary[]; total: number }>('GET', `/messages?${qs}`);
  },
  counts: () => request<Counts>('GET', '/messages/counts'),
  message: (id: string) => request<MessageDetail>('GET', `/messages/${id}`),
  send: (payload: SendPayload) => request<{ entryId: string; conversationId: string; message: MessageDetail }>('POST', '/messages', payload),
  setFlags: (id: string, flags: { isRead?: boolean; isStarred?: boolean }) => request<MessageDetail>('PATCH', `/messages/${id}`, flags),
  batch: (ids: string[], action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'restore' | 'spam' | 'not_spam' | 'delete') =>
    request<{ affected: number }>('POST', '/messages/batch', { ids, action }),
  emptyFolder: (folder: 'trash' | 'spam') => request<{ deleted: number }>('POST', `/folders/${folder}/empty`),

  drafts: () => request<{ items: Draft[] }>('GET', '/drafts'),
  createDraft: (payload: DraftPayload) => request<Draft>('POST', '/drafts', payload),
  updateDraft: (id: string, payload: DraftPayload) => request<Draft>('PUT', `/drafts/${id}`, payload),
  deleteDraft: (id: string) => request<{ ok: true }>('DELETE', `/drafts/${id}`),

  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<Attachment>('POST', '/attachments', form);
  },
  deleteUpload: (id: string) => request<{ ok: true }>('DELETE', `/attachments/${id}`),
  lookup: (q: string) => request<LookupResult>('GET', `/lookup?q=${encodeURIComponent(q)}`),
};
