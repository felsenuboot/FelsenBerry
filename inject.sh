#!/usr/bin/env bash
# inject.sh <port> — inject (or re-inject) skills.js into a running bot via POST /eval.
# Re-injection is idempotent: it stops any running __skills task and replaces the engine.
set -euo pipefail
PORT="${1:?usage: ./inject.sh <port>}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
jq -Rs '{code:.}' "$DIR/skills.js" \
  | curl -s -X POST "http://127.0.0.1:$PORT/eval" -H 'Content-Type: application/json' -d @- \
  | jq -c .
