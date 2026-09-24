#!/usr/bin/env bash
# Simulates Twilio's webhooks locally (works when TWILIO_AUTH_TOKEN is not set, i.e. signatures are not enforced).
#   scripts/simulate-twilio.sh call +919876543210     # IVR: call and press 1
#   scripts/simulate-twilio.sh sms  +919876543210     # SMS: text JOIN
#   scripts/simulate-twilio.sh gate +919876543210     # SMSGate: text JOIN to your gateway phone (dev mode only)
set -euo pipefail
BASE="${PHONEMAIL_URL:-http://localhost:8088}"
kind="${1:-call}"
from="${2:-+919876543210}"
case "$kind" in
  call)
    echo "--- Incoming call"
    curl -s -X POST "$BASE/api/twilio/voice" --data-urlencode "From=$from" --data-urlencode "CallSid=CAtest"; echo
    echo "--- Caller presses 1"
    curl -s -X POST "$BASE/api/twilio/voice/menu" --data-urlencode "From=$from" --data-urlencode "Digits=1"; echo
    ;;
  sms)
    curl -s -X POST "$BASE/api/twilio/sms" --data-urlencode "From=$from" --data-urlencode "Body=JOIN"; echo
    ;;
  gate)
    curl -s -X POST "$BASE/api/smsgate/webhook" -H 'Content-Type: application/json' \
      -d "{\"event\": \"sms:received\", \"payload\": {\"sender\": \"$from\", \"message\": \"JOIN\"}}"; echo
    ;;
  *)
    echo "usage: $0 call|sms|gate <E.164 number>" >&2
    exit 1
    ;;
esac
