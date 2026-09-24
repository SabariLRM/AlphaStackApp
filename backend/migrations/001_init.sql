-- PhoneMail initial schema.
-- Addresses are always stored lower-cased. Phone numbers are stored in E.164 (+<country><number>).

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               text NOT NULL UNIQUE,
  address             text NOT NULL UNIQUE,
  display_name        text NOT NULL DEFAULT '',
  about               text NOT NULL DEFAULT '',
  language            text NOT NULL DEFAULT 'en',
  signature           text NOT NULL DEFAULT '',
  avatar_key          text,
  avatar_updated_at   timestamptz,
  sms_notifications   boolean NOT NULL DEFAULT true,
  registration_source text NOT NULL CHECK (registration_source IN ('mobile', 'web', 'portal', 'ivr', 'sms')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Every deliverable address (primary phone address + user-defined aliases) resolves through this table.
CREATE TABLE addresses (
  address    text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('primary', 'alias')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  client       text NOT NULL CHECK (client IN ('web', 'mobile')),
  device_name  text NOT NULL DEFAULT '',
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('login', 'register')),
  provider    text NOT NULL,
  code_hash   text,
  attempts    integer NOT NULL DEFAULT 0,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX otp_phone_idx ON otp_challenges (phone, created_at DESC);
CREATE INDEX otp_ip_idx ON otp_challenges (ip, created_at DESC);

-- Immutable email content. One row per email, shared by every mailbox that holds a copy.
CREATE TABLE emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        text NOT NULL,
  in_reply_to       text,
  references_header text[] NOT NULL DEFAULT '{}',
  from_address      text NOT NULL,
  from_name         text NOT NULL DEFAULT '',
  to_list           jsonb NOT NULL DEFAULT '[]',
  cc_list           jsonb NOT NULL DEFAULT '[]',
  bcc_list          jsonb NOT NULL DEFAULT '[]',
  subject           text NOT NULL DEFAULT '',
  text_body         text NOT NULL DEFAULT '',
  html_body         text,
  snippet           text NOT NULL DEFAULT '',
  has_attachments   boolean NOT NULL DEFAULT false,
  size_bytes        integer NOT NULL DEFAULT 0,
  origin            text NOT NULL CHECK (origin IN ('local', 'smtp')),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emails_message_id_idx ON emails (message_id);

-- A chat: every email a user sends or receives is filed into the conversation whose
-- participant set (everyone except the user) matches the email's participants.
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_key  text NOT NULL,
  participants     text[] NOT NULL,
  is_group         boolean NOT NULL,
  is_favorite      boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, participant_key)
);
CREATE INDEX conversations_user_activity_idx ON conversations (user_id, last_activity_at DESC);

-- A user's copy of an email (IMAP-style), with per-user state.
CREATE TABLE mailbox_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id          uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction         text NOT NULL CHECK (direction IN ('in', 'out')),
  folder            text NOT NULL CHECK (folder IN ('inbox', 'sent', 'spam', 'trash')),
  previous_folder   text CHECK (previous_folder IN ('inbox', 'sent', 'spam')),
  is_read           boolean NOT NULL DEFAULT false,
  is_starred        boolean NOT NULL DEFAULT false,
  reply_to_entry_id uuid REFERENCES mailbox_entries(id) ON DELETE SET NULL,
  reply_entry_id    uuid REFERENCES mailbox_entries(id) ON DELETE SET NULL,
  replied_at        timestamptz,
  trashed_at        timestamptz,
  sent_at           timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_user_folder_idx ON mailbox_entries (user_id, folder, sent_at DESC);
CREATE INDEX entries_conversation_idx ON mailbox_entries (conversation_id, sent_at DESC);
CREATE INDEX entries_email_idx ON mailbox_entries (email_id);
CREATE INDEX entries_user_created_idx ON mailbox_entries (user_id, created_at DESC);

CREATE TABLE drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE CASCADE,
  reply_to_entry_id uuid REFERENCES mailbox_entries(id) ON DELETE SET NULL,
  from_address      text,
  to_list           text[] NOT NULL DEFAULT '{}',
  cc_list           text[] NOT NULL DEFAULT '{}',
  bcc_list          text[] NOT NULL DEFAULT '{}',
  subject           text NOT NULL DEFAULT '',
  body              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drafts_user_idx ON drafts (user_id, updated_at DESC);
-- At most one chat-composer draft per conversation.
CREATE UNIQUE INDEX drafts_conversation_uniq ON drafts (conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  email_id     uuid REFERENCES emails(id) ON DELETE SET NULL,
  draft_id     uuid REFERENCES drafts(id) ON DELETE SET NULL,
  filename     text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  content_id   text,
  is_inline    boolean NOT NULL DEFAULT false,
  storage_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_email_idx ON attachments (email_id);
CREATE INDEX attachments_draft_idx ON attachments (draft_id);
CREATE INDEX attachments_owner_idx ON attachments (owner_id);

-- Senders a user reported as spam. Future mail from them goes straight to Spam.
CREATE TABLE spam_senders (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, address)
);

-- Durable background job queue (SMS sends, external relay).
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE status = 'pending';

CREATE TABLE sms_log (
  id                  bigserial PRIMARY KEY,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  to_phone            text NOT NULL,
  body                text NOT NULL,
  purpose             text NOT NULL CHECK (purpose IN ('otp', 'notification', 'welcome')),
  provider            text NOT NULL,
  status              text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_log_user_idx ON sms_log (user_id, purpose, created_at DESC);
CREATE INDEX sms_log_created_idx ON sms_log (created_at DESC);

CREATE INDEX emails_from_idx ON emails (from_address, sent_at DESC);
