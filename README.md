# Я рядом — экспериментальный MVP

Mini App + **тонкий Telegram-клиент** + JSON-store + служебный чат. **Без PostgreSQL.**

Фокус пилота: бытовая помощь в **одной зоне**. Аренда жилья не входит в основной сценарий.

## Инварианты

1. **Одна заявка → один TAKE** — `tryTake()` синхронный. **Только один процесс Node**.
2. **Источник истины** — `data/orders.json`.
3. **GPS** — только внутри store; после COMPLETE/CANCEL обнуляется.
4. **Служебный чат** — хроника, не БД.
5. **Расстояние в `/nearby`** — buckets.
6. **Контакт после TAKE** — username / t.me, без телефона и точных координат.

## Жизненный цикл

| Состояние | Кто меняет |
|-----------|------------|
| OPEN | создатель (create / cancel) |
| TAKEN | исполнитель (take); создатель или исполнитель (cancel) |
| COMPLETED | только исполнитель |
| CANCELLED | с `cancelReason` |

## Безопасность

| Тема | Статус |
|------|--------|
| initData | HMAC + auth_date TTL 1ч |
| Native client | HMAC v1 payload, TTL ±300с, timingSafeEqual |
| CORS | exact origin: WEB_APP_URL + CORS_ORIGINS + localhost |
| Rate limit | create / nearby / take / cancel |
| complete / cancel | проверка прав на сервере |

**Важно:** NATIVE_CLIENT_SECRET в APK — shared-secret, не Telegram Login.

## Запуск

```bash
cp .env.example .env
pnpm install
pnpm --filter @ya-ryadom/bot smoke
pnpm dev:bot
pnpm dev:web
```

Production: см. `deploy/DEPLOY.md` (`pnpm build:web && docker compose up -d --build`, replicas=1).

Метрики: `data/events.jsonl`. Бэкап: `orders.json.bak`.

Native: `android-module/` + форк telegram-x.

## Операционные заметки (аудит 2026-10-09)

- CORS: только точные origin из `WEB_APP_URL` + `CORS_ORIGINS` + localhost dev.
- Compose: volume только `bot-data` → `/app/data`, без mount всего репозитория.
- Перед деплоем: `pnpm build:web`, затем `docker compose up -d --build`.
- Не масштабировать реплики бота.
