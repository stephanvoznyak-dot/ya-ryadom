# Ya Ryadom (Я рядом)

Experimental MVP of a local help-request service — “help nearby”.

Built as a **Telegram Mini App + Bot** with an optional **native Android module** for Telegram X.  
No PostgreSQL. The single source of truth is a JSON file store.

---

## Features

- Create requests (“I need help”) with category, description, search radius and lifetime
- Discover and claim open requests nearby (“I can help”) using GPS
- Complete claimed requests
- Works entirely through the Telegram bot **or** the Mini App
- Native Android client for Telegram X with HMAC-signed authentication

---

## Project Structure

```
ya-ryadom/
├── apps/
│   ├── bot/                 # Node.js bot + REST API (Grammy + Fastify)
│   └── web/                 # React Mini App (Vite + TypeScript)
├── android-module/          # Drop-in module for Telegram X
│   ├── YaRyadomController.kt
│   ├── data/
│   ├── ui/
│   ├── util/
│   ├── backend-native-auth-patch.ts
│   └── INTEGRATION.md
├── deploy/                  # nginx config & deployment notes
├── docker-compose.yml
└── ...
```

---

## Quick Start (Backend + Mini App)

```bash
cp .env.example .env
# Fill in:
#   TOKEN              – Telegram bot token
#   WEB_APP_URL        – public URL of the Mini App
#   SERVICE_CHAT_ID    – private service group (operator chronicle)
#   NATIVE_CLIENT_SECRET – long random secret for Android native client (HMAC)

pnpm install

# Optional: verify atomic TAKE invariant
pnpm --filter @ya-ryadom/bot smoke

pnpm dev:bot          # starts the bot + API
pnpm dev:web          # starts the Mini App (Vite)
```

Production:

```bash
pnpm build:web
pnpm start:bot
# or
docker compose up -d
```

---

## Native Telegram X Module

See the detailed guide:

**[android-module/INTEGRATION.md](android-module/INTEGRATION.md)**

Short version:

1. Copy the contents of `android-module/` into  
   `app/src/main/java/org/thunderdog/challegram/yaryadom/`
2. Apply `backend-native-auth-patch.ts` and set `NATIVE_CLIENT_SECRET`
3. Wire the controller into Telegram X navigation
4. Build the APK

A fork of Telegram X with the module already integrated:  
https://github.com/stephanvoznyak-dot/telegram-x

---

## Core Invariants

1. **One request → one taker**  
   `tryTake()` is synchronous (load → check → save, no `await`).

2. **Source of truth**  
   `data/orders.json`, not Telegram messages.

3. **Privacy of location**  
   GPS coordinates of other users’ requests are never returned in public API responses.

4. **Service chat**  
   Used only as an operator chronicle. After a request is taken, the location line is removed from the service message.

---

## API

All endpoints are `POST`.  
Authentication:

- Mini App → Telegram `initData`
- Native client → HMAC-SHA256 signature (`userId:firstName:timestamp`)

| Endpoint                | Description                    |
|-------------------------|--------------------------------|
| `/api/orders`           | Create a new request           |
| `/api/orders/nearby`    | Find open requests nearby      |
| `/api/orders/take`      | Atomically claim a request     |
| `/api/orders/mine`      | List requests claimed by me    |
| `/api/orders/complete`  | Mark a request as completed    |
| `/health`               | Health check                   |

---

## Categories

`DELIVERY` · `RIDE` · `HELP` · `SHOPPING` · `REPAIR` · `CLEANING` · `COMPUTER` · `RENTAL` · `OTHER`

Search radii: 1 / 2 / 5 / 10 / 20 km.

---

## Tech Stack

| Layer          | Technology                          |
|----------------|-------------------------------------|
| Bot + API      | Node.js 22+, Grammy, Fastify, Zod   |
| Mini App       | React, Vite, TypeScript             |
| Storage        | Atomic JSON file (`tmp` + rename)   |
| Native client  | Kotlin (Telegram X module)          |
| Deploy         | Docker Compose + nginx              |

---

## License

Private experimental project.
