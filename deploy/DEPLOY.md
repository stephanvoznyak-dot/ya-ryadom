# Deploy checklist (single VPS)

## Prerequisites

- Docker + Docker Compose
- Domain DNS → server
- Telegram bot token

## Steps

```bash
git clone https://github.com/stephanvoznyak-dot/ya-ryadom.git
cd ya-ryadom

cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, SERVICE_CHAT_ID, WEB_APP_URL=https://your-domain.com
# Optional: NATIVE_CLIENT_SECRET, CORS_ORIGINS

# Restore full P0 index.ts (cancel, contact, exact CORS) if parts are present:
bash deploy/restore-index.sh

corepack enable
pnpm install
pnpm --filter @ya-ryadom/bot smoke
pnpm build:web

docker compose up -d --build
curl -s http://127.0.0.1/health
```

## HTTPS

```bash
# Install certs into deploy/certs/, uncomment TLS in deploy/nginx.conf
# and cert volume in docker-compose.yml, then:
docker compose up -d
```

## BotFather

- Menu Button / Web App URL = value of `WEB_APP_URL`
- Do not add end users to `SERVICE_CHAT_ID` group

## Invariants

- `deploy.replicas` for bot must stay **1**
- Source of truth: `data/orders.json` (volume `bot-data`)
- Metrics: `data/events.jsonl` inside the volume
- Full bot entrypoint: `apps/bot/src/index.ts` (after `restore-index.sh` if using GH parts)
