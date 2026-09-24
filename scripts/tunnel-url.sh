#!/usr/bin/env bash
# Prints the public HTTPS URL of the free Cloudflare quick tunnel (started with: docker compose --profile tunnel up -d).
# The URL changes every time the tunnel restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
for _ in $(seq 1 30); do
  url=$(docker compose --profile tunnel logs tunnel 2>/dev/null | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  if [ -n "$url" ]; then
    echo "$url"
    exit 0
  fi
  sleep 2
done
echo "Tunnel URL not found. Start it with: docker compose --profile tunnel up -d" >&2
exit 1
