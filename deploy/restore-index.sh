#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cat "$ROOT"/deploy/index.ts.b64.part* > "$ROOT/deploy/index.ts.b64"
base64 -d "$ROOT/deploy/index.ts.b64" > "$ROOT/apps/bot/src/index.ts"
echo "Restored apps/bot/src/index.ts ($(wc -c < "$ROOT/apps/bot/src/index.ts") bytes)"
grep -E "buildCorsAllowlist|tryCancel|contactCard|cancelord" "$ROOT/apps/bot/src/index.ts" | head -8
