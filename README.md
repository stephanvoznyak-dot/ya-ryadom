# Я рядом — экспериментальный MVP

Mini App + **тонкий Telegram-клиент** + JSON-store + служебный чат. **Без PostgreSQL.**

## Инварианты

1. **Одна заявка → один TAKE** — `tryTake()` синхронный (load→check→save без await). **Только один процесс Node** — не масштабируйте реплики бота.
2. **Источник истины** — `data/orders.json`, не сообщение в Telegram.
3. **GPS** — только внутри store для nearby; в API пользователям не отдаётся. После COMPLETE/CANCEL координаты обнуляются.
4. **Служебный чат** — хроника; после TAKE сообщение редактируется, строка 📍 убирается.
5. **Расстояние в `/nearby`** — отдаётся в корзинах (bucket), не с точностью до метра.

## Безопасность (кратко)

| Тема | Статус |
|------|--------|
| `initData` | HMAC + `auth_date` TTL 1 час |
| Native client | HMAC-SHA256, каноничный payload `v1\nuserId=…`, TTL ±300 с, `timingSafeEqual` |
| `/nearby`, `/take` | In-memory rate limit (на процесс) |
| `radiusMeters` | Только whitelist 1/2/5/10/20 км |
| `complete` | Только исполнитель (`takerTelegramId`) |
| `take` | Свою заявку взять нельзя |
| TLS | nginx на :80; HTTPS терминировать выше или раскомментировать блок в `deploy/nginx.conf` |

**Важно:** `NATIVE_CLIENT_SECRET` попадает в APK. Это shared-secret против случайных запросов, не полноценная аутентификация уровня Telegram Login. При утечке — перевыпустить секрет и пересобрать клиент.

## Тонкий клиент (бот)

| Действие | Как |
|----------|-----|
| Создать заявку | «Мне нужно» → геолокация → категория → описание → радиус |
| Найти рядом | «Я могу» → геолокация → радиус → «Взять» |
| Мои взятые | «Мои заявки» → «Завершить» |
| Mini App | Кнопка «Mini App» или `/app` |

## Запуск

```bash
cp .env.example .env
# TOKEN, SERVICE_CHAT_ID, WEB_APP_URL, NATIVE_CLIENT_SECRET

pnpm install
pnpm --filter @ya-ryadom/bot smoke   # атомарность TAKE
pnpm dev:bot
pnpm dev:web
```

Production:

```bash
pnpm build:web
docker compose up -d   # bot replicas = 1
```

`SERVICE_CHAT_ID` — закрытая группа, бот админ, пользователей приложения не добавлять.

## Native Telegram X

См. `ya-ryadom-module/INTEGRATION.md` и форк https://github.com/stephanvoznyak-dot/telegram-x

## Лицензия

Private experimental project. Форк Telegram X (GPLv3) при распространении APK обязывает открыть исходники модуля.
