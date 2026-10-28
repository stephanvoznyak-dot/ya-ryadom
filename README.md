# Я рядом

Mini App + тонкий Telegram-клиент + JSON-журнал заявок + служебная хроника.
Взаимная помощь рядом. **Без PostgreSQL.** Одна заявка — один TAKE.

Репозиторий: [github.com/stephanvoznyak-dot/ya-ryadom](https://github.com/stephanvoznyak-dot/ya-ryadom)

Версия **0.5.1**

Подтянуто из [github.com/stephanvoznyak-dot/ya-ryadom](https://github.com/stephanvoznyak-dot/ya-ryadom): бот с REST API, Mini App, модуль Telegram X.

Исправлено в этой версии:

- создание заявки в боте снова собирает объект (обрыв `addOrder` ломал API)
- лента и бот отдают диапазон дистанции (`рядом`, `до 1 км`…), не точные метры
- отмена с причиной доступна в API и в диалоге бота; координаты обнуляются
- после TAKE в ответе есть username заказчика, без GPS
- CORS только для адреса Mini App и localhost; лимиты на создание, поиск, TAKE и отмену
- журнал пишется с `orders.json.bak` и `events.jsonl`, просроченные заявки снимаются сами
- HMAC нативного клиента сравнивается по байтам подписи

**Статус проверки (28.10.2026 ~13:15 MSK, sandbox):** typecheck для `apps/bot` проходит успешно; smoke-take — все 7 тестов проходят. Обновлён zod до 4.6.7 — high severity vulnerability (GHSA-mrhx-c7xc-m3w5) закрыта, `npm audit` чист.

## Инварианты

1. **Одна OPEN-заявка → один победитель TAKE** — `tryTake()` синхронный (load → check → save без await).
2. **Источник истины** — журнал заявок, не сообщение в Telegram.
3. **GPS** только внутри store для nearby; в карточки ленты не попадает.
4. **Служебный чат / хроника** — после TAKE координаты снимаются.

## Что в комплекте

| Каталог | Что это |
|---------|
| `apps/web/` | Telegram Mini App |
| `apps/bot/` | Telegram-бот и JSON-журнал |
| `android-module/` | Модуль для Telegram X |
| `native/ios/` | Проект Xcode / SwiftUI |
| `native/android/` | Android / Compose, сборка APK |
| `src/` | Демо в превью (если открыто вместе с оболочкой) |

## Веб

Демо работает без Telegram: две персоны (Анна / Максим), чтобы проверить атомарный TAKE.
Вкладка **Код** скачивает ZIP исходников.

## Xcode

```
native/ios/YaRyadom.xcodeproj
```

Откройте на Mac, выберите iPhone Simulator, Run. Signing: ваш Team в target YaRyadom.

## Android APK

```
cd native/android
# Android Studio → Open → native/android → Build APK
```

Либо GitHub Actions: workflow **Android APK** → артефакт `ya-ryadom-debug-apk`.

Debug APK не для магазина — только установка на своё устройство.

## Бот

```
cd apps/bot
cp .env.example .env
# TOKEN, WEB_APP_URL, SERVICE_CHAT_ID, NATIVE_CLIENT_SECRET
npx tsx src/smoke-take.ts
npx tsx src/index.ts
```

## План оптимизации и следующие задачи

Текущее состояние: прототип с чёткими инвариантами, JSON-store, smoke-тестами. Подходит для локального тестирования.

Приоритетные улучшения:

1. Расширить тестовое покрытие (vitest/юнит-тесты для store, API, edge-cases отмены/истечения).
2. Добавить структурированное логирование и метрики (Prometheus/простой health-check).
3. Улучшить документацию API (OpenAPI/примеры запросов).
4. Настроить Dependabot и автоматические security-проверки.
5. Рассмотреть миграцию store на SQLite/другой локальный сторедж для лучшей отказоустойчивости (сохранить инварианты).
6. Добавить e2e-сценарии для Mini App.

Новые задачи заведены в Issues репозитория.

## Лицензия

Прототип. Не production без аудита.
