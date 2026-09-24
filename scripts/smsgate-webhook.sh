#!/usr/bin/env bash
# Free SMS sign-up: tells your SMSGate phone to forward incoming texts to PhoneMail, so texting
# JOIN to that phone's ordinary number creates an account.
#   scripts/smsgate-webhook.sh            # uses the tunnel URL
#   scripts/smsgate-webhook.sh https://example.org
# Needs SMSGATE_USERNAME / SMSGATE_PASSWORD (and SMSGATE_SIGNING_KEY for the API) in .env.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${SMSGATE_USERNAME:?set SMSGATE_USERNAME in .env}"
: "${SMSGATE_PASSWORD:?set SMSGATE_PASSWORD in .env}"
gate="${SMSGATE_URL:-https://api.sms-gate.app/3rdparty/v1}"
base="${1:-}"
[ -n "$base" ] || base="$(scripts/tunnel-url.sh)"
curl -sS -u "$SMSGATE_USERNAME:$SMSGATE_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "${gate%/}/webhooks" \
  -d "{\"url\": \"$base/api/smsgate/webhook\", \"event\": \"sms:received\"}"
echo
