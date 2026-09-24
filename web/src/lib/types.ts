export interface Mailbox {
  address: string;
  name: string;
}

export interface Me {
  id: string;
  phone: string;
  address: string;
  displayName: string;
  about: string;
  language: string;
  signature: string;
  avatarUrl: string | null;
  smsNotifications: boolean;
  registrationSource: 'mobile' | 'web' | 'portal' | 'ivr' | 'sms';
  aliases: string[];
  hasMobileApp: boolean;
  createdAt: string;
}

export interface AppConfig {
  mailDomain: string;
  defaultCountry: string;
  defaultCallingCode: string;
  otpLength: number;
  otpResendSeconds: number;
  devSmsOutbox: boolean;
  externalMail: boolean;
  maxAttachmentBytes: number;
  webUrl: string;
  portalUrl: string;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline?: boolean;
  url?: string;
}

export type Folder = 'inbox' | 'sent' | 'spam' | 'trash' | 'starred' | 'all';

export interface MessageSummary {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  folder: 'inbox' | 'sent' | 'spam' | 'trash';
  isRead: boolean;
  isStarred: boolean;
  sentAt: string;
  subject: string;
  snippet: string;
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  hasAttachments: boolean;
  repliedAt: string | null;
  replyToEntryId: string | null;
}

export interface MessageDetail extends MessageSummary {
  messageId: string;
  text: string;
  html: string | null;
  bcc: Mailbox[];
  attachments: Attachment[];
  replyTo: { id: string; direction: 'in' | 'out'; subject: string; snippet: string; from: Mailbox; sentAt: string } | null;
  canReply: boolean;
}

export interface Draft {
  id: string;
  conversationId: string | null;
  replyToEntryId: string | null;
  fromAddress: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Counts {
  inboxUnread: number;
  spamUnread: number;
  drafts: number;
  starred: number;
  trash: number;
}

export interface SessionInfo {
  id: string;
  client: 'web' | 'mobile';
  deviceName: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
