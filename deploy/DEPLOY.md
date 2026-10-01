# Деплой

См. docker-compose.yml и nginx.conf.

1. Скопировать `.env.example` → `.env`, заполнить токены и SERVICE_CHAT_ID.
2. `pnpm install && pnpm build:web`
3. `docker compose up -d`
