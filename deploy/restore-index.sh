#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cat "$ROOT/deploy/index.ts.b64.part0" "$ROOT/deploy/index.ts.b64.part1" > "$ROOT/deploy/index.ts.b64"
base64 -d "$ROOT/deploy/index.ts.b64" > "$ROOT/apps/bot/src/index.ts"
BYTES=$(wc -c < "$ROOT/apps/bot/src/index.ts")
echo "Restored apps/bot/src/index.ts ($BYTES bytes)"
grep -E "buildCorsAllowlist|tryCancel|contactCard|cancelord" "$ROOT/apps/bot/src/index.ts" | head -8
test "$BYTES" -gt 30000
