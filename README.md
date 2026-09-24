# PhoneMail

**Your phone number is your email address.** `9876543210` → `9876543210@phonemail.com`

PhoneMail is an email service built for the **AlphaStack 7-Day Buildathon**. People get a mailbox for their phone number by calling a toll-free number and pressing **1**, by sending an SMS, from a two-field registration portal, from the web client, or from the Android app. Email is read in a **WhatsApp-style Android app** (email organised as chats, Spike-style), in a **Gmail-style web client**, or — for people without the app — announced by **SMS**.

```
docker compose up -d
```

| What | URL |
| --- | --- |
| Web client (Gmail-style) | http://localhost:8088 |
| Registration portal (phone + OTP only) | http://localhost:8089 |
| Inbound SMTP server (MX) | `localhost:2525` |
| Mailpit — catches mail sent to external addresses | http://localhost:8025 |
| **Local phone** — call the toll-free number, text it, read the SMS PhoneMail sends you (OTPs, alerts) | http://localhost:8088/api/dev/phone |
| Android app | [`releases/PhoneMail.apk`](releases/PhoneMail.apk) (also served at http://localhost:8088/downloads/PhoneMail.apk) |

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Android app](#android-app)
- [SMS, OTP, IVR — providers](#sms-otp-and-ivr)
- [Configuration](#configuration)
- [How conversations work](#how-conversations-work)
- [API overview](#api-overview)
- [Security](#security)
- [Development & tests](#development--tests)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

## Features

### Account creation (all create the same `<number>@phonemail.com` mailbox)

| Method | How |
| --- | --- |
| **Toll-free number (IVR)** | Call the Twilio number → *“To create your PhoneMail account, press 1”* → the account is created for the caller ID and the address is read out (and texted). Press **2** to hear your address. |
| **SMS** | Text anything (e.g. `JOIN`) to the Twilio number → the reply contains your new address. `HELP` explains; opt-out keywords are left to Twilio. For free, text `JOIN` to an ordinary Indian number running the SMSGate app instead (see below). |
| **Registration portal** | http://localhost:8089 — exactly two fields, *Phone number* and *OTP*. After an account is created the form resets for the next one. It can only reach the registration endpoints. |
| **Web client** | One screen: phone number, OTP, one **Next** button, and *“By signing up, you agree to the Terms of Service”* (linked). New numbers are signed up automatically. |
| **Android app** | Language → Terms → phone number (detected from the SIM and pre-filled, editable) → OTP (read from the SMS automatically and verified without a tap) → inbox. |

Authentication is **OTP-based everywhere** (no passwords). Codes are 6 digits, HMAC-hashed at rest, expire after 5 minutes, allow 5 attempts, and are rate-limited per number and per IP.

### Android app (WhatsApp design language, Spike-style email-as-chat)

- **Onboarding**: language selection (English, हिन्दी, தமிழ், తెలుగు — the whole app is translated), Terms & Privacy, phone number with country picker, OTP, contacts/notifications permission screen, profile info (name + photo).
- **Permissions asked at the right step**: phone number/SIM (`READ_PHONE_NUMBERS`, `READ_PHONE_STATE`) and SMS (`RECEIVE_SMS`) on the phone-number screen; contacts and notifications right after verification. The number is read from the SIM, falling back to Google's Phone Number Hint picker. The OTP is detected through `RECEIVE_SMS` **and** the permission-less SMS Retriever API (the server appends the app hash).
- **Home**: full-width search bar, filter chips **All / Unread / Attachments / Favourites**, chats list (contact names from the phone book, unread badges, `Draft:` previews), top-left menu **Home (Inbox + Sent unified) / Drafts / Spam / Trash**, profile picture top-right → settings.
- **Two ways to compose**: the bottom-right **compose** button (traditional view), or **chat view** — type a phone number in the search bar (or pick a contact) and start typing.
- **Chats**: one chat per sender (emails from the same person always land in the same chat); new emails show their **subject** at the top of the bubble; **swipe right** on a message to reply — the reply is linked to (quotes) the original and the subject field is hidden while replying; **each email can be replied to only once** (enforced by the server); long emails are truncated — **tap any email** to open it in the traditional view with a **Reply** button at the bottom.
- **Traditional view inside a chat**: the envelope button where WhatsApp has its camera opens a full compose screen with **To locked** to the chat's participants (no Cc/new recipients). To reply in the traditional view, swipe right and tap the expand icon, or long-press → *Reply in traditional view*.
- **Group chats**: composing from Home to two or more recipients creates a group chat; later one-to-one emails still go to the one-to-one chat.
- **Settings**: profile (name, about, photo), **Alias IDs** (up to 5 extra addresses such as `asha@phonemail.com`, usable as *From*), app language, notifications, linked devices (sign out other devices), server URL, log out, delete account.
- Attachments (upload, image previews, open with other apps), stars, favourites, spam reporting (blocks the sender), trash/restore, drafts synced with the server, dark mode, real-time updates over WebSocket and background new-mail notifications.

### Web client (Gmail-style)

Inbox / Starred / Sent / Drafts / All Mail / Spam / Trash, search, bulk actions, a Gmail-like compose window (minimise / full screen, Cc/Bcc, From alias picker, attachments, auto-saved drafts), reader with sandboxed HTML rendering, reply / reply-all / forward (respecting the one-reply rule), live updates over WebSocket, light/dark theme, responsive layout. **Settings & profile**: name, language, SMS alerts, signature, profile photo, about, alias IDs, devices & sessions, blocked senders, account deletion.

### SMS notifications

Users **without the mobile app** (registered by call, SMS, portal or web and with no active app session) get an SMS for every new email:

> You have received an email from &lt;Sender&gt;. Subject: &lt;Subject&gt;.

Sent from a durable job queue with retries, capped at 10 per user per hour, never for Spam, and switchable off in web settings. As soon as a user signs in to the Android app they get push-style app notifications instead.

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    A[Android app<br/>Kotlin + Compose]
    W[Web client<br/>React + Vite]
    P[Registration portal<br/>static HTML]
  end
  subgraph Telephony
    T[Twilio<br/>toll-free number]
  end
  EXT[(Other mail servers)]
  subgraph "docker compose"
    NW[nginx :8088<br/>web + /api proxy]
    NP[nginx :8089<br/>portal + /api/portal]
    API[API · Node.js/TypeScript<br/>Fastify, WebSocket, job worker]
    MX[SMTP server · Go<br/>go-smtp + enmime :2525]
    DB[(PostgreSQL)]
    MP[Mailpit<br/>outbound catcher]
  end
  SMS[SMS provider<br/>console · Twilio trial · Verify · SMSGate]

  A -- REST + WebSocket --> NW
  W --> NW --> API
  P --> NP --> API
  T -- voice/SMS webhooks --> NW
  EXT -- SMTP --> MX -- RCPT check + deliver --> API
  API --> DB
  API -- relay external mail --> MP
  API -- OTP + alerts --> SMS
```

- **API (Node.js 22, TypeScript, Fastify 5)** — accounts, OTP, sessions, mailboxes, conversations, drafts, attachments, Twilio webhooks, WebSocket push, and a Postgres-backed **job queue** (`FOR UPDATE SKIP LOCKED`) for SMS and external relay.
- **SMTP server (Go)** — an inbound-only MX. It rejects unknown recipients during `RCPT TO` (asks the API), refuses to relay, rejects mail that claims a `@phonemail.com` sender (anti-spoofing), enforces size limits, parses MIME (attachments, inline `cid:` images, threading headers) and hands the message to the API.
- **PostgreSQL** — one immutable `emails` row per message plus per-user `mailbox_entries` (folder, read/star flags, reply link), `conversations`, `drafts`, `attachments`, `addresses` (primary + aliases), `sessions`, `otp_challenges`, `jobs`, `sms_log`.
- **Mailpit** — sending to non-PhoneMail addresses (gmail.com…) goes through an SMTP relay; locally that is Mailpit so you can inspect it. Point `SMTP_RELAY_URL` at a real relay to deliver for real.

## Quick start

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/SabariLRM/AlphaStackApp.git
cd AlphaStackApp
docker compose up -d
```

**Everything runs locally** with the defaults — no accounts, no `.env`, no internet services:

- **Mail** — users email each other through PhoneMail; mail “from the outside” enters through the built-in SMTP server (`localhost:2525`), and mail to outside addresses is caught by Mailpit (http://localhost:8025).
- **SMS, calls and OTPs** — nothing is sent to a real phone. The **local phone** (http://localhost:8088/api/dev/phone) stands in for one: enter your number, *call* the toll-free number and press 1 (the prompts are spoken by your browser), *text* JOIN to the SMS number, and read every SMS PhoneMail sends you — sign-in codes, welcome texts and “You have received an email from …” alerts.

Twilio and SMSGate are optional extras for real phones (see [SMS, OTP and IVR](#sms-otp-and-ivr)).

### Try it

1. **Register on the portal** — http://localhost:8089, enter `98765 43210`, tap *Get OTP*, read the code on the local phone (number `+91 98765 43210`), enter it. You get `9876543210@phonemail.com` and the form resets.
2. **Sign in to the web client** — http://localhost:8088 with another number (it is created automatically), compose an email to `9876543210`.
3. **Receive mail from “outside”** through the SMTP server:
   ```bash
   python3 scripts/send-test-email.py 9876543210 --from "Priya <priya@example.org>" --subject "Quarterly numbers" --html
   ```
   `9876543210` has no app session, so an SMS alert shows up in the outbox.
4. **Toll-free call / SMS sign-up** — on the local phone, change the number, tap *Call PhoneMail* and press **1**, or text **JOIN**. The same works from a terminal:
   ```bash
   scripts/simulate-twilio.sh call +919000011111   # “press 1”
   scripts/simulate-twilio.sh sms  +919000022222   # text JOIN
   ```
5. **Send to an external address** (e.g. `someone@gmail.com`) and open Mailpit at http://localhost:8025.
6. **Android**: install the APK on an emulator — it talks to `http://10.0.2.2:8088` out of the box.

## Android app

Download [`releases/PhoneMail.apk`](releases/PhoneMail.apk) (Android 8.0+, signed with a debug key so it installs without a keystore).

- **Emulator**: install and open; the default server is `http://10.0.2.2:8088` (the host's docker compose). The emulator's SIM number is detected automatically. Read the code on the local phone, or deliver it to the emulator as a real SMS to watch it being filled in and verified automatically:
  ```bash
  adb emu sms send 12345 "Your PhoneMail code is 123456"
  ```
- **Real phone on the same Wi-Fi**: on the first screen tap the server icon (top-right) — or *Settings → Server settings* later — and enter `http://<your-computer-LAN-IP>:8088`.
- **Build it yourself** (JDK 17, Android SDK 35):
  ```bash
  cd android
  ./gradlew assembleRelease                      # app/build/outputs/apk/release/app-release.apk
  ./gradlew assembleRelease -PphonemailServerUrl=http://192.168.1.20:8088   # different default server
  ```

Background notifications: while the app process is alive, new mail arrives instantly over the WebSocket; otherwise a WorkManager job checks every 15 minutes (Android's minimum). The server treats a user as “having the app” while a mobile session has been used in the last 14 days and stops sending SMS alerts.

## SMS, OTP and IVR

`SMS_PROVIDER` chooses how texts (OTPs, welcome messages, new-mail alerts) are sent; `OTP_PROVIDER` chooses who generates and checks codes.

| `SMS_PROVIDER` | Cost | Custom text | Notes |
| --- | --- | --- | --- |
| `console` *(default)* | free | yes | Nothing leaves the server; see the dev SMS outbox. |
| `twilio` | free trial credit | yes* | Programmable Messaging from your Twilio trial number. Trial accounts can only text verified numbers; *some countries (e.g. India) block unregistered custom text on trial.* |
| `twilio_verify` | free trial credit | template only | Uses Twilio Verify's pre-approved template as the “you have mail” ping, as the buildathon clarification allows. Requires `OTP_PROVIDER=twilio_verify`. Welcome texts are skipped. |
| `smsgate` | **free** | yes | [SMSGate](https://sms-gate.app): the open-source app on any Android phone sends the SMS from its SIM — full custom text (the notification wording above), including to Indian numbers, within your SIM's free SMS pack. Texting `JOIN` to that phone also creates an account. |

Only free options are supported: paid gateways were deliberately left out.

| `OTP_PROVIDER` | |
| --- | --- |
| `local` *(default)* | PhoneMail generates the code and sends it through `SMS_PROVIDER`. The message ends with the Android app hash so the SMS Retriever API can read it. |
| `twilio_verify` | Twilio Verify sends and checks the code (app hash passed as `AppHash`). |

### Free public URL (for Twilio and SMSGate webhooks)

Twilio and SMSGate need to reach your machine over HTTPS. The compose file includes a **Cloudflare quick tunnel** — free, no account:

```bash
docker compose --profile tunnel up -d
scripts/tunnel-url.sh          # → https://<random-words>.trycloudflare.com
```

The URL changes whenever the tunnel restarts; update the Twilio/SMSGate webhooks when it does. Twilio signatures are validated against the tunnel's public URL automatically (or set `TWILIO_WEBHOOK_BASE_URL`).

### Setting up the Twilio free trial (toll-free IVR + SMS)

1. Create a free Twilio trial account (no card needed), verify your own phone number, and claim the free trial phone number.
2. Start the tunnel (above) and, in the Twilio console, configure the number:
   - **A call comes in** → Webhook → `POST https://<tunnel>/api/twilio/voice`
   - **A message comes in** → Webhook → `POST https://<tunnel>/api/twilio/sms`
3. `.env` (pick one of the SMS setups):
   ```ini
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx          # also enables webhook signature validation
   TWILIO_FROM_NUMBER=+1XXXXXXXXXX     # the free trial number

   # a) custom-text SMS from the trial number (works for countries that allow it on trial)
   SMS_PROVIDER=twilio
   OTP_PROVIDER=local

   # b) template-only (works for Indian numbers on a trial)
   # SMS_PROVIDER=twilio_verify
   # OTP_PROVIDER=twilio_verify
   # TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx
   ```
4. `docker compose up -d` and call the number: *press 1*.

**Testing the IVR without paying for an international call.** The trial number is a US number, so calling it from an Indian SIM costs ISD rates. Instead, let Twilio call you — receiving calls is free — and you hear the same menu:

```bash
scripts/twilio-call-me.sh +91XXXXXXXXXX     # your verified number
```

The IVR voice defaults to `Polly.Aditi` (`en-IN`); change it with `IVR_VOICE` / `IVR_LANGUAGE`.

### Free custom SMS and free SMS sign-up with SMSGate

1. Install **SMS Gateway for Android** ([sms-gate.app](https://sms-gate.app), free and open source) on an Android phone with a SIM, enable *Cloud server*, and note the username and password it shows. Under *Settings → Webhooks* copy the signing key.
2. `.env`:
   ```ini
   SMS_PROVIDER=smsgate
   OTP_PROVIDER=local
   SMSGATE_USERNAME=...
   SMSGATE_PASSWORD=...
   SMSGATE_SIGNING_KEY=...
   ```
3. `docker compose up -d`, start the tunnel, then register the incoming-SMS webhook:
   ```bash
   scripts/smsgate-webhook.sh
   ```
Now OTPs and new-mail alerts go out as normal SMS from that phone, and anyone who texts **JOIN** to the phone's ordinary (local) number gets an account and a reply with their address. Other texts to the phone are ignored. Webhooks are verified with the signing key (HMAC-SHA256).

## Configuration

All settings are environment variables read by `docker-compose.yml` (put them in `.env`). The most important:

| Variable | Default | |
| --- | --- | --- |
| `MAIL_DOMAIN` | `phonemail.com` | Domain of every address. |
| `DEFAULT_COUNTRY` | `IN` | Numbers without a country code use this; its numbers get national addresses (`9876543210@…`), other countries use full digits (`14155550100@…`). |
| `APP_SECRET` | *(set it!)* | HMAC key for OTPs and signed attachment links. |
| `INTERNAL_API_TOKEN` | *(set it!)* | Shared secret between the SMTP server and the API. |
| `WEB_PORT` / `PORTAL_PORT` / `SMTP_PORT` / `MAILPIT_PORT` | 8088 / 8089 / 2525 / 8025 | Host ports. |
| `PUBLIC_WEB_URL` | `http://localhost:8088` | Used in SMS texts. |
| `SMS_PROVIDER`, `OTP_PROVIDER` | `console`, `local` | See above. |
| `SMSGATE_SIGNING_KEY` | — | Required to accept SMSGate incoming-SMS webhooks. |
| `SMS_NOTIFY_MAX_PER_HOUR` | 10 | SMS alert cap per user. |
| `SMTP_RELAY_URL` | `smtp://mailpit:1025` | Outbound relay for external recipients; empty disables external mail. |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS. |

See [`.env.example`](.env.example) for everything (Twilio, SMSGate, IVR voice…).

## How conversations work

Every email a user sends or receives is filed, **for that user**, into the conversation whose participant set equals *everyone on From/To/Cc except the user*:

- A → B: A's chat `{B}`, B's chat `{A}`. B's reply lands in the same chats.
- A → B, C (compose from Home): A's group chat `{B, C}`, B's `{A, C}`, C's `{A, B}`. Replies inside the group go to everyone and stay in the group.
- A → B later: back in the one-to-one chat `{B}` — never the group.
- Aliases fold into their owner's primary address, so mail to `bala@phonemail.com` or `9876543210@phonemail.com` is the same chat.
- Mail to yourself goes to a “Message yourself” chat.

Sending inside a chat (`POST /api/conversations/:id/messages`) always uses the chat's participants — the server ignores any recipients a client might add. Replies carry `In-Reply-To`/`References`, get a `Re:` subject from the original, and link both copies (`reply_to_entry_id`). The one-reply rule is enforced atomically with a row lock on the original entry.

## API overview

All endpoints are under `/api` (proxied by nginx). Web sessions use an `httpOnly` cookie plus an `X-Requested-With` header on writes (CSRF); the app uses `Authorization: Bearer`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify` (`client: web \| mobile`), `POST /auth/logout` |
| Portal | `POST /portal/otp/request`, `POST /portal/register` |
| Profile | `GET/PATCH/DELETE /me`, `PUT/DELETE /me/avatar`, `GET/POST/DELETE /me/aliases`, `GET/DELETE /me/sessions`, `GET/DELETE /me/blocked`, `GET /avatars/:userId` |
| Chats | `GET /conversations?filter=all\|unread\|attachments\|favorites&q=`, `POST /conversations/open`, `GET /conversations/:id`, `GET/POST /conversations/:id/messages`, `POST /conversations/:id/read`, `PATCH /conversations/:id`, `DELETE /conversations/:id`, `POST /conversations/:id/spam`, `GET/PUT/DELETE /conversations/:id/draft` |
| Mail | `GET /messages?folder=inbox\|sent\|starred\|all\|spam\|trash&q=`, `GET /messages/counts`, `GET/PATCH/DELETE /messages/:id`, `POST /messages` (compose), `POST /messages/:id/move`, `POST /messages/batch`, `POST /folders/:folder/empty`, `GET /sync/notifications` |
| Drafts | `GET/POST /drafts`, `GET/PUT/DELETE /drafts/:id` |
| Files | `POST /attachments` (multipart), `DELETE /attachments/:id`, `GET /attachments/:id/download` (signed URL) |
| Lookup | `GET /lookup?q=`, `POST /contacts/match` |
| Realtime | `GET /ws` (WebSocket: `entry.created`, `entries.updated`, `conversation.updated`, `drafts.updated`, `profile.updated`) |
| Twilio | `POST /twilio/voice`, `POST /twilio/voice/menu`, `POST /twilio/sms` |
| SMSGate | `POST /smsgate/webhook` (signed incoming-SMS webhook) |
| Misc | `GET /config`, `GET /health`, `GET /dev/phone`, `GET /dev/sms[/view]` (local mode only) |

## Security

- OTP-only sign-in: HMAC-SHA256-hashed codes, single use, 5-minute expiry, 5 attempts, 30 s resend cooldown, per-number and per-IP hourly limits; only the newest code is valid.
- Opaque 256-bit session tokens stored as SHA-256 hashes; revocable per device; `httpOnly` `SameSite=Lax` cookie + CSRF header for the web.
- Twilio webhook signatures verified (HMAC-SHA1) when an auth token is configured; SMSGate webhooks verified with HMAC-SHA256 and a 5-minute timestamp window.
- SMTP: no open relay, unknown recipients rejected at `RCPT`, local-domain sender spoofing rejected, size limits.
- Inbound HTML sanitised server-side (`sanitize-html`), rendered in a script-less sandboxed iframe (web) and a JavaScript-disabled WebView (Android); links open externally.
- Attachments served through short-lived HMAC-signed URLs with `nosniff`, safe `Content-Disposition` and a restrictive CSP; uploads size-limited; avatars validated by magic bytes.
- Aliases must start with a letter, so nobody can squat someone else's phone-number address; reserved names blocked.
- Rate limiting (Fastify), Helmet headers, strict CSP on the web client and portal; the portal's nginx only exposes the registration endpoints; internal SMTP endpoints are not proxied and require a shared token.
- Reporting spam blocks the sender; SMS alerts are capped per hour.

## Development & tests

```bash
# Backend (needs a Postgres; tests use TEST_DATABASE_URL, default postgres://test:test@localhost:55432/phonemail_test)
docker run -d --name phonemail-testdb -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=phonemail_test -p 55432:5432 postgres:16-alpine
cd backend && npm ci && npm test          # 50 integration + unit tests
npm run dev                               # API on :3000 (DATABASE_URL=...)

cd mailserver && go test ./...            # SMTP session + MIME parsing tests

cd web && npm ci && npm run dev           # Vite on :5173, proxies /api to :3000
```

The backend tests drive the real HTTP API against Postgres: OTP flows and lockouts, CSRF, portal, chats/grouping/aliases, the one-reply rule, attachments and signed URLs, spam/trash/drafts, SMTP ingestion with sanitisation, SMS alerts (and their suppression for app users and the hourly cap), and Twilio IVR/SMS/signature validation.

## Project layout

```
backend/     Node.js API (TypeScript, Fastify, Postgres) + tests
  migrations/  SQL schema
mailserver/  Go SMTP server (inbound MX)
web/         Web client (React, Vite) served by nginx
portal/      Registration portal (static) served by nginx
android/     Android app (Kotlin, Jetpack Compose)
releases/    Built APK
scripts/     send-test-email.py, simulate-twilio.sh, tunnel-url.sh, twilio-call-me.sh, smsgate-webhook.sh
```

## Everything is local and free

| Piece | Local, free option |
| --- | --- |
| Hosting | `docker compose up -d` on your own machine |
| Calls, SMS and OTPs | The local phone at http://localhost:8088/api/dev/phone (default) |
| Public HTTPS URL for webhooks | Cloudflare quick tunnel (`--profile tunnel`, no account) |
| Toll-free number + IVR + SMS | Twilio free trial (trial credit; verified numbers only). Test the IVR with `scripts/twilio-call-me.sh` so you receive the call instead of paying for an international one. |
| OTP and new-mail SMS | Dev outbox, Twilio trial (Verify template for India), or SMSGate on your own phone |
| SMS sign-up with a local number | SMSGate (`JOIN`) |
| Email between users and from other servers | Built-in SMTP server; mail to outside addresses is caught by Mailpit |
| Android app | APK in `releases/` (no Play Store account needed) |

## Known limitations

- Outbound delivery to the real internet needs an SMTP relay (`SMTP_RELAY_URL`) and a domain with SPF/DKIM; locally external mail is captured by Mailpit.
- Twilio trial accounts only call/text verified numbers and prefix messages with a trial notice. The trial number is a US number: calling or texting it from India is charged by your mobile operator — use `twilio-call-me.sh` and SMSGate to stay free.
- Delivering to real Gmail/Outlook inboxes or receiving from them needs a domain you own (with MX/SPF/DKIM records); `phonemail.com` is only used locally, as the brief's “SMTP (local)” intends.
- Background notifications without Firebase are checked every 15 minutes when the app process is not running.
- The APK is signed with a debug key; use your own keystore for store releases.
