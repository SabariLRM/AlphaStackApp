#!/usr/bin/env bash
# Free IVR test: Twilio calls YOUR phone and plays the "press 1 to create your account" menu.
# Receiving a call is free, while calling a US trial number from India costs international rates.
#   scripts/twilio-call-me.sh +919876543210
# Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in .env, and the number must be
# verified in your Twilio trial (Console → Phone Numbers → Verified Caller IDs).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
to="${1:?usage: $0 +91XXXXXXXXXX}"
: "${TWILIO_ACCOUNT_SID:?set TWILIO_ACCOUNT_SID in .env}"
: "${TWILIO_AUTH_TOKEN:?set TWILIO_AUTH_TOKEN in .env}"
: "${TWILIO_FROM_NUMBER:?set TWILIO_FROM_NUMBER in .env}"
base="${TWILIO_WEBHOOK_BASE_URL:-}"
[ -n "$base" ] || base="$(scripts/tunnel-url.sh)"
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json" \
  --data-urlencode "To=$to" \
  --data-urlencode "From=$TWILIO_FROM_NUMBER" \
  --data-urlencode "Url=$base/api/twilio/voice" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status") or d.get("message"), d.get("sid", ""))'
