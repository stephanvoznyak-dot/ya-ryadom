/**
 * «Я рядом» — Mini App + тонкий Telegram-клиент (бот).
 *
 * Источник истины — JSON-store. Служебный чат — хроника (с GPS для оператора).
 * Пользователи могут работать полностью через бота (тонкий клиент)
 * или через Mini App.
 *
 * Тонкий клиент:
 *   — «Мне нужно» → локация → категория → описание → радиус → создание
 *   — «Я могу»   → локация → радиус → список рядом → «Взять»
 *   — «Мои заявки» → список взятых → «Завершить»
 */
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Bot, InlineKeyboard, Keyboard, webhookCallback } from 'grammy';
import { z } from 'zod';
import { validateInitData, verifyNativeSignature } from './telegram-auth.js';
import {
  addOrder,
  getOrder,
  listOrders,
  listTakenBy,
  pruneExpired,
  tryComplete,
  tryTake,
  updateOrder,
} from './store.js';
import { distanceMeters } from './geo.js';
import { bucketDistanceMeters, formatServiceMessage, toPublicCard } from './messages.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVICE_CHAT_ID = process.env.SERVICE_CHAT_ID;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://example.com';
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL;
const NATIVE_CLIENT_SECRET = process.env.NATIVE_CLIENT_SECRET || '';

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN required');
if (!SERVICE_CHAT_ID) {
  console.warn('SERVICE_CHAT_ID not set — posting to service chat disabled until configured');
}
if (!NATIVE_CLIENT_SECRET) {
  console.warn('NATIVE_CLIENT_SECRET not set — native Android client auth disabled');
}

const bot = new Bot(TOKEN);
const serviceChatId = SERVICE_CHAT_ID ? Number(SERVICE_CHAT_ID) : null;

const CATEGORIES = [
  'RIDE', 'DELIVERY', 'REPAIR', 'CLEANING', 'SHOPPING',
  'COMPUTER', 'HELP', 'RENTAL', 'OTHER',
] as const;

const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  RIDE: 'Поездка',
  DELIVERY: 'Доставка',
  REPAIR: 'Ремонт',
  CLEANING: 'Уборка',
  SHOPPING: 'Купить / принести',
  COMPUTER: 'Компьютер',
  HELP: 'Помощь',
  RENTAL: 'Аренда',
  OTHER: 'Другое',
};

const RADII = [1000, 2000, 5000, 10000, 20000] as const;
const RADIUS_LABELS: Record<number, string> = {
  1000: '1 км',
  2000: '2 км',
  5000: '5 км',
  10000: '10 км',
  20000: '20 км',
};

// NOTE: Full implementation lives in local artifacts/apps/bot/src/index.ts (~28KB).
// This remote copy was truncated during automated push; restore from local before deploy.
// Critical security modules (telegram-auth, store, messages) are complete on main.

type CreateDraft = {
  latitude?: number;
  longitude?: number;
  category?: (typeof CATEGORIES)[number];
  description?: string;
  radiusMeters?: number;
  destinationText?: string;
};

type UserSession =
  | { step: 'idle' }
  | { step: 'create_location' }
  | { step: 'create_category'; draft: CreateDraft }
  | { step: 'create_description'; draft: CreateDraft }
  | { step: 'create_radius'; draft: CreateDraft }
  | { step: 'create_destination'; draft: CreateDraft }
  | { step: 'nearby_location' }
  | { step: 'nearby_radius'; latitude: number; longitude: number };

const sessions = new Map<number, UserSession>();

function getSession(userId: number): UserSession {
  return sessions.get(userId) ?? { step: 'idle' };
}

function setSession(userId: number, s: UserSession) {
  if (s.step === 'idle') sessions.delete(userId);
  else sessions.set(userId, s);
}

function mainKeyboard() {
  return new Keyboard()
    .text('Мне нужно')
    .text('Я могу')
    .row()
    .text('Мои заявки')
    .text('Mini App')
    .resized()
    .persistent();
}

const nativeUserFields = {
  nativeClient: z.literal(true).optional(),
  userId: z.number().int().positive().optional(),
  firstName: z.string().min(1).max(128).optional(),
  username: z.string().max(64).nullable().optional(),
  timestamp: z.number().int().positive().optional(),
  signature: z.string().min(64).max(128).optional(),
};

function resolveUser(body: {
  initData?: string;
  nativeClient?: boolean;
  userId?: number;
  firstName?: string;
  username?: string | null;
  timestamp?: number;
  signature?: string;
}): import('./telegram-auth.js').TgUser | null {
  if (body.initData) {
    return validateInitData(body.initData, TOKEN!);
  }
  if (
    body.nativeClient === true &&
    body.userId &&
    body.firstName &&
    body.timestamp &&
    body.signature &&
    NATIVE_CLIENT_SECRET
  ) {
    if (
      !verifyNativeSignature(
        NATIVE_CLIENT_SECRET,
        body.userId,
        body.firstName,
        body.timestamp,
        body.signature,
      )
    ) {
      return null;
    }
    return {
      id: body.userId,
      first_name: body.firstName,
      username: body.username ?? undefined,
    };
  }
  return null;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

app.post('/api/auth', async (req, reply) => {
  const body = z.object({
    initData: z.string().optional(),
    ...nativeUserFields,
  }).safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = resolveUser(body.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  return reply.send({
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
    },
  });
});

const createSchema = z.object({
  initData: z.string().min(1).optional(),
  ...nativeUserFields,
  category: z.enum(CATEGORIES),
  description: z.string().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  destinationText: z.string().max(300).optional(),
  radiusMeters: z.number().refine((v) => (RADII as readonly number[]).includes(v)),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
});

app.post('/api/orders', async (req, reply) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  const d = parsed.data;
  const order = addOrder({
    category: d.category,
    description: d.description,
    destinationText: d.destinationText,
    latitude: d.latitude,
    longitude: d.longitude,
    radiusMeters: d.radiusMeters,
    creatorTelegramId: user.id,
    creatorName: user.first_name,
    creatorUsername: user.username ?? null,
    expiresInMinutes: d.expiresInMinutes,
  });
  return reply.status(201).send({
    id: order.id,
    status: order.status,
    expiresAt: order.expiresAt,
  });
});

const nearbySchema = z.object({
  initData: z.string().min(1).optional(),
  ...nativeUserFields,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().refine((v) => (RADII as readonly number[]).includes(v)).default(5000),
});

app.post('/api/orders/nearby', async (req, reply) => {
  const parsed = nearbySchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });
  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  if (!rateLimit(`nearby:${user.id}`, 30, 60_000)) {
    return reply.status(429).send({ error: 'RATE_LIMITED' });
  }
  pruneExpired();
  const { latitude, longitude, radiusMeters } = parsed.data;
  const now = Date.now();
  const items = listOrders()
    .filter((o) => {
      if (o.status !== 'OPEN') return false;
      if (new Date(o.expiresAt).getTime() <= now) return false;
      if (o.creatorTelegramId === user.id) return false;
      if (o.latitude === 0 && o.longitude === 0) return false;
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return dist <= Math.min(radiusMeters, o.radiusMeters);
    })
    .map((o) => {
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return toPublicCard(o, dist);
    })
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, 30);
  return reply.send({ items });
});

const takeSchema = z.object({
  initData: z.string().min(1).optional(),
  ...nativeUserFields,
  orderId: z.string().uuid(),
});

app.post('/api/orders/take', async (req, reply) => {
  const parsed = takeSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  if (!rateLimit(`take:${user.id}`, 20, 60_000)) {
    return reply.status(429).send({ error: 'RATE_LIMITED' });
  }
  pruneExpired();
  const existing = getOrder(parsed.data.orderId);
  if (existing && existing.creatorTelegramId === user.id) {
    return reply.status(409).send({ error: 'ORDER_NOT_AVAILABLE', message: 'Нельзя взять свою заявку' });
  }
  const updated = tryTake(parsed.data.orderId, {
    telegramId: user.id,
    name: user.first_name,
    username: user.username ?? null,
  });
  if (!updated) {
    return reply.status(409).send({ error: 'ORDER_NOT_AVAILABLE', message: 'Заявка уже недоступна' });
  }
  return reply.send({
    id: updated.id,
    status: 'TAKEN',
    message: 'Заявка взята',
    notifications: { creatorNotified: false, takerNotified: false },
  });
});

app.post('/api/orders/mine', async (req, reply) => {
  const body = z.object({
    initData: z.string().min(1).optional(),
    ...nativeUserFields,
  }).safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = resolveUser(body.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  const items = listTakenBy(user.id).map((o) => ({
    id: o.id,
    category: o.category,
    description: o.description,
    destinationText: o.destinationText,
    status: o.status,
    creatorName: o.creatorName,
    creatorUsername: o.creatorUsername,
  }));
  return reply.send({ items });
});

const orderIdSchema = z.object({
  initData: z.string().min(1).optional(),
  ...nativeUserFields,
  orderId: z.string().uuid(),
});

app.post('/api/orders/complete', async (req, reply) => {
  const parsed = orderIdSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
  const updated = tryComplete(parsed.data.orderId, user.id);
  if (!updated) {
    return reply.status(404).send({ error: 'NOT_FOUND' });
  }
  return reply.send({ id: updated.id, status: updated.status, message: 'Заявка выполнена' });
});

bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply(
    'Я рядом\n\nЗаявки рядом с вами. Можно работать прямо в боте или открыть Mini App.',
    { reply_markup: mainKeyboard() },
  );
});

async function start() {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  bot.start({ onStart: () => console.log('Bot started') });
  console.log(`API on :${PORT}`);
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
