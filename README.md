# Я рядом (ya-ryadom)

Экспериментальный MVP сервиса локальных заявок («помощь рядом»).

**Стек:** Telegram Mini App + Bot + JSON-store + нативный модуль для Telegram X (Android).

Без PostgreSQL. Источник истины — `data/orders.json`.

## Возможности

- Создание заявок («Мне нужно») с категорией, описанием, радиусом и сроком
- Поиск и взятие открытых заявок рядом («Я могу») по GPS
- Завершение взятых заявок
- Работа через Mini App **или** тонкий клиент бота
- Нативный Android-модуль для Telegram X с HMAC-авторизацией

## Структура репозитория

```
ya-ryadom/
├── apps/
│   ├── bot/          # Node.js бот + REST API (Grammy + Fastify)
│   └── web/          # React Mini App (Vite + TypeScript)
├── android-module/   # Модуль для интеграции в Telegram X
│   ├── YaRyadomController.kt
│   ├── data/
│   ├── ui/
│   ├── util/
│   ├── backend-native-auth-patch.ts
│   └── INTEGRATION.md
├── deploy/           # nginx + инструкции
├── docker-compose.yml
└── ...
```

## Быстрый запуск (backend + Mini App)

```bash
cp .env.example .env
# Заполните TOKEN, WEB_APP_URL, SERVICE_CHAT_ID
# Для native-клиента также: NATIVE_CLIENT_SECRET=...

pnpm install
pnpm --filter @ya-ryadom/bot smoke   # проверка атомарности TAKE
pnpm dev:bot
pnpm dev:web
```

Production: `docker compose up -d` или `pnpm build:web && pnpm start:bot`.

## Нативный модуль Telegram X

См. подробную инструкцию:

**[android-module/INTEGRATION.md](android-module/INTEGRATION.md)**

Кратко:
1. Скопировать `android-module/` → `app/src/main/java/org/thunderdog/challegram/yaryadom/`
2. Применить `backend-native-auth-patch.ts` и задать `NATIVE_CLIENT_SECRET`
3. Подключить контроллер в навигацию Telegram X
4. Собрать APK

Форк Telegram X с уже интегрированным модулем:  
https://github.com/stephanvoznyak-dot/telegram-x

## Инварианты

1. Одна заявка может быть взята только одним исполнителем (`tryTake` атомарный).
2. Источник истины — `orders.json`, не сообщения Telegram.
3. GPS-координаты чужих заявок никогда не отдаются в публичные ответы API.
4. Служебный чат используется только как хроника для оператора.

## API

Все эндпоинты — `POST`, авторизация через `initData` (Mini App) или HMAC-подпись (native):

- `/api/orders` — создание
- `/api/orders/nearby` — поиск рядом
- `/api/orders/take` — атомарный захват
- `/api/orders/mine` — мои взятые
- `/api/orders/complete` — завершение

## Лицензия

Приватный экспериментальный проект.
