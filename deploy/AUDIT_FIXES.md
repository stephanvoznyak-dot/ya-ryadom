# Audit fix status (2026-10-09)

## Applied on GitHub main
- docker-compose.yml: volume only bot-data, image build from Dockerfile
- apps/bot/Dockerfile: healthcheck, pnpm 9.15
- deploy/nginx.conf: TLS template, client_max_body_size
- deploy/DEPLOY.md: checklist + restore-index
- .env.example: WEB_APP_URL, CORS_ORIGINS
- apps/bot/src/store.ts: tryCancel, events, backup
- apps/bot/src/messages.ts: contactCard
- apps/bot/src/smoke-take.ts: cancel tests
- apps/web/package.json: no broken @ya-ryadom/shared
- README operational notes

## Full P0 index.ts
Source of truth: local artifacts or:
1. `tar -xzf ya-ryadom-bot-p0-src.tgz`
2. or `bash deploy/restore-index.sh` after uploading index.ts.b64.part0/1

Markers to verify:
- buildCorsAllowlist
- tryCancel
- contactCard
- cancelord
- SHOPPING (no RENTAL in main list)
