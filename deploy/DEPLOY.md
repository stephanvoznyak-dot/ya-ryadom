# Deploy

```bash
cp .env.example .env   # TOKEN, WEB_APP_URL, SERVICE_CHAT_ID
pnpm install
pnpm build:web
pnpm start:bot         # or docker compose up -d
```

HTTPS + nginx: static `apps/web/dist`, proxy `/api` и `/bot` на процесс бота (:3000).
