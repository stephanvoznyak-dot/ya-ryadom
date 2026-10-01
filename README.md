# Я рядом — экспериментальный MVP

Mini App + **тонкий Telegram-клиент** + JSON-store + служебный чат. **Без PostgreSQL.**

## Инварианты

1. **Одна заявка → один TAKE** — `tryTake()` синхронный (load→check→save без await).
2. **Источник истины** — `data/orders.json`, не сообщение в Telegram.
3. **GPS** — только внутри store для nearby; в API Mini App и в ответах пользователям не отдаётся.
4. **Служебный чат** — хроника; после TAKE сообщение редактируется, строка 📍 убирается.

## Тонкий клиент (бот)

Пользователь может работать **полностью через Telegram-бота**, без открытия Mini App:

| Действие | Как |
|----------|-----|
| Создать заявку | «Мне нужно» → геолокация → категория → описание → радиус → пункт назначения |
| Найти рядом | «Я могу» → геолокация → радиус → список карточек → «Взять» |
| Мои взятые | «Мои заявки» → «Завершить» |
| Mini App | Кнопка «Mini App» или `/app` |

Состояние диалога хранится in-memory (один процесс Node). Геолокация запрашивается нативной кнопкой Telegram.

## Цепочка

```
Telegram (бот или Mini App)
  → CREATE → JSON + пост в SERVICE_CHAT (с GPS)
  → nearby (haversine, без lat/lng в ответе)
  → TAKE → tryTake → edit message (−GPS) → notify
  → COMPLETE → TAKEN → COMPLETED
```

## Запуск

```bash
cp .env.example .env
pnpm install
pnpm --filter @ya-ryadom/bot smoke   # атомарность TAKE
pnpm dev:bot
pnpm dev:web
```

`SERVICE_CHAT_ID` — закрытая группа, бот админ, пользователей приложения не добавлять.
