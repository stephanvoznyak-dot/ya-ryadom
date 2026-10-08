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
const SERVICE_CHAT_ID = process.env.SERVICE_CHAT_ID; // e.g. -100xxxxxxxxxx
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

// ── Тонкий клиент: состояние диалога (in-memory, один процесс) ──
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

function locationKeyboard(cancelLabel = 'Отмена') {
  return new Keyboard()
    .requestLocation('📍 Отправить геолокацию')
    .row()
    .text(cancelLabel)
    .resized()
    .oneTime();
}

function categoryKeyboard() {
  const kb = new InlineKeyboard();
  const entries = Object.entries(CATEGORY_LABELS) as [typeof CATEGORIES[number], string][];
  for (let i = 0; i < entries.length; i += 2) {
    const [k1, l1] = entries[i];
    kb.text(l1, `cat:${k1}`);
    if (entries[i + 1]) {
      const [k2, l2] = entries[i + 1];
      kb.text(l2, `cat:${k2}`);
    }
    kb.row();
  }
  kb.text('« Отмена', 'cancel');
  return kb;
}

function radiusKeyboard(prefix: 'crad' | 'nrad') {
  const kb = new InlineKeyboard();
  for (const r of RADII) {
    kb.text(RADIUS_LABELS[r], `${prefix}:${r}`).row();
  }
  kb.text('« Отмена', 'cancel');
  return kb;
}

async function postToServiceChat(order: import('./store.js').Order) {
  if (!serviceChatId) return;
  try {
    const msg = await bot.api.sendMessage(
      serviceChatId,
      formatServiceMessage(order, true),
      {
        reply_markup: new InlineKeyboard().text('Взять (служебно)', `take:${order.id}`),
      },
    );
    updateOrder(order.id, {
      serviceMessageId: msg.message_id,
      serviceChatId,
    });
  } catch (e) {
    console.error('Failed to post to service chat', e);
  }
}

async function stripGpsFromService(order: import('./store.js').Order) {
  if (!order.serviceChatId || !order.serviceMessageId) return;
  try {
    await bot.api.editMessageText(
      order.serviceChatId,
      order.serviceMessageId,
      formatServiceMessage(order, false),
    );
  } catch {
    /* message may be gone */
  }
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
  await postToServiceChat(order);
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

  await stripGpsFromService(updated);

  let creatorNotified = false;
  let takerNotified = false;
  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Вашу заявку взяли.\n${updated.description}\nИсполнитель: ${user.first_name}${user.username ? ` @${user.username}` : ''}`,
    );
    creatorNotified = true;
  } catch {
    /* user may have blocked bot */
  }
  try {
    await bot.api.sendMessage(
      user.id,
      `Вы взяли заявку.\n${updated.description}\nОт: ${updated.creatorName}${updated.creatorUsername ? ` @${updated.creatorUsername}` : ''}`,
    );
    takerNotified = true;
  } catch {
    /* ignore */
  }

  return reply.send({
    id: updated.id,
    status: 'TAKEN',
    message: 'Заявка взята',
    notifications: { creatorNotified, takerNotified },
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

  await stripGpsFromService(updated);

  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Заявка выполнена.\n${updated.description}`,
    );
  } catch {
    /* ignore */
  }

  return reply.send({
    id: updated.id,
    status: 'COMPLETED',
    message: 'Заявка выполнена',
  });
});

// ── Bot dialogs (thin client) ──

bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply(
    'Я рядом\n\nЗаявки рядом с вами. Можно работать прямо в боте или открыть Mini App.',
    { reply_markup: mainKeyboard() },
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('Открыть Mini App:', {
    reply_markup: new InlineKeyboard().webApp('Mini App', WEB_APP_URL),
  });
});

bot.command('cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.hears('Отмена', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.hears('Mini App', async (ctx) => {
  await ctx.reply('Открыть Mini App:', {
    reply_markup: new InlineKeyboard().webApp('Mini App', WEB_APP_URL),
  });
});

bot.hears('Мне нужно', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setSession(userId, { step: 'create_location' });
  await ctx.reply('Отправьте геолокацию, где нужна помощь.', {
    reply_markup: locationKeyboard(),
  });
});

bot.hears('Я могу', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setSession(userId, { step: 'nearby_location' });
  await ctx.reply('Отправьте свою геолокацию, чтобы найти заявки рядом.', {
    reply_markup: locationKeyboard(),
  });
});

bot.hears('Мои заявки', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  pruneExpired();
  const items = listTakenBy(userId);
  if (items.length === 0) {
    await ctx.reply('У вас нет взятых заявок.', { reply_markup: mainKeyboard() });
    return;
  }
  for (const o of items) {
    const label = CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category;
    await ctx.reply(
      `${label}\n${o.description}${o.destinationText ? `\n→ ${o.destinationText}` : ''}\nОт: ${o.creatorName}${o.creatorUsername ? ` @${o.creatorUsername}` : ''}`,
      {
        reply_markup: new InlineKeyboard().text('Завершить', `complete:${o.id}`),
      },
    );
  }
});

bot.on('message:location', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const loc = ctx.message.location;
  if (!loc) return;
  const session = getSession(userId);

  if (session.step === 'create_location') {
    setSession(userId, {
      step: 'create_category',
      draft: { latitude: loc.latitude, longitude: loc.longitude },
    });
    await ctx.reply('Выберите категорию:', { reply_markup: categoryKeyboard() });
    return;
  }

  if (session.step === 'nearby_location') {
    setSession(userId, {
      step: 'nearby_radius',
      latitude: loc.latitude,
      longitude: loc.longitude,
    });
    await ctx.reply('В каком радиусе искать?', { reply_markup: radiusKeyboard('nrad') });
    return;
  }
});

bot.on('callback_query:data', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();

  if (data === 'cancel') {
    setSession(userId, { step: 'idle' });
    await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
    return;
  }

  if (data.startsWith('cat:')) {
    const cat = data.slice(4) as (typeof CATEGORIES)[number];
    const session = getSession(userId);
    if (session.step !== 'create_category') return;
    setSession(userId, {
      step: 'create_description',
      draft: { ...session.draft, category: cat },
    });
    await ctx.reply('Опишите, что нужно (текстом):');
    return;
  }

  if (data.startsWith('crad:')) {
    const radius = Number(data.slice(5));
    const session = getSession(userId);
    if (session.step !== 'create_radius') return;
    if (!(RADII as readonly number[]).includes(radius)) return;
    const draft = { ...session.draft, radiusMeters: radius };
    setSession(userId, { step: 'create_destination', draft });
    await ctx.reply(
      'Куда / уточнение (необязательно). Или отправьте «-» чтобы пропустить.',
    );
    return;
  }

  if (data.startsWith('nrad:')) {
    const radius = Number(data.slice(5));
    const session = getSession(userId);
    if (session.step !== 'nearby_radius') return;
    if (!(RADII as readonly number[]).includes(radius)) return;
    pruneExpired();
    const now = Date.now();
    const items = listOrders()
      .filter((o) => {
        if (o.status !== 'OPEN') return false;
        if (new Date(o.expiresAt).getTime() <= now) return false;
        if (o.creatorTelegramId === userId) return false;
        if (o.latitude === 0 && o.longitude === 0) return false;
        const dist = distanceMeters(session.latitude, session.longitude, o.latitude, o.longitude);
        return dist <= Math.min(radius, o.radiusMeters);
      })
      .map((o) => {
        const dist = distanceMeters(session.latitude, session.longitude, o.latitude, o.longitude);
        return { order: o, dist: bucketDistanceMeters(dist) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 15);

    setSession(userId, { step: 'idle' });
    if (items.length === 0) {
      await ctx.reply('Рядом пока нет открытых заявок.', { reply_markup: mainKeyboard() });
      return;
    }
    for (const { order: o, dist } of items) {
      const label = CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category;
      const distLabel = dist < 1000 ? `~${dist} м` : `~${dist / 1000} км`;
      await ctx.reply(
        `${label} · ${distLabel}\n${o.description}${o.destinationText ? `\n→ ${o.destinationText}` : ''}\nОт: ${o.creatorName}`,
        {
          reply_markup: new InlineKeyboard().text('Взять', `take:${o.id}`),
        },
      );
    }
    await ctx.reply('Выберите заявку или вернитесь в меню.', { reply_markup: mainKeyboard() });
    return;
  }

  if (data.startsWith('take:')) {
    const orderId = data.slice(5);
    pruneExpired();
    const existing = getOrder(orderId);
    if (existing && existing.creatorTelegramId === userId) {
      await ctx.reply('Нельзя взять свою заявку.');
      return;
    }
    const updated = tryTake(orderId, {
      telegramId: userId,
      name: ctx.from.first_name,
      username: ctx.from.username ?? null,
    });
    if (!updated) {
      await ctx.reply('Заявка уже недоступна.');
      return;
    }
    await stripGpsFromService(updated);
    try {
      await bot.api.sendMessage(
        updated.creatorTelegramId,
        `Вашу заявку взяли.\n${updated.description}\nИсполнитель: ${ctx.from.first_name}${ctx.from.username ? ` @${ctx.from.username}` : ''}`,
      );
    } catch {
      /* ignore */
    }
    await ctx.reply(
      `Вы взяли заявку.\n${updated.description}\nОт: ${updated.creatorName}${updated.creatorUsername ? ` @${updated.creatorUsername}` : ''}`,
      { reply_markup: mainKeyboard() },
    );
    return;
  }

  if (data.startsWith('complete:')) {
    const orderId = data.slice(9);
    const updated = tryComplete(orderId, userId);
    if (!updated) {
      await ctx.reply('Не удалось завершить (уже закрыта или не ваша).');
      return;
    }
    await stripGpsFromService(updated);
    try {
      await bot.api.sendMessage(
        updated.creatorTelegramId,
        `Заявка выполнена.\n${updated.description}`,
      );
    } catch {
      /* ignore */
    }
    await ctx.reply('Заявка отмечена как выполненная.', { reply_markup: mainKeyboard() });
    return;
  }
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message.text?.trim();
  if (!text) return;
  const session = getSession(userId);

  // Ignore main menu buttons handled by hears
  if (['Мне нужно', 'Я могу', 'Мои заявки', 'Mini App', 'Отмена'].includes(text)) return;

  if (session.step === 'create_description') {
    if (text.length < 3) {
      await ctx.reply('Слишком коротко. Опишите подробнее (минимум 3 символа).');
      return;
    }
    setSession(userId, {
      step: 'create_radius',
      draft: { ...session.draft, description: text.slice(0, 500) },
    });
    await ctx.reply('В каком радиусе показывать заявку?', { reply_markup: radiusKeyboard('crad') });
    return;
  }

  if (session.step === 'create_destination') {
    const dest = text === '-' ? undefined : text.slice(0, 300);
    const draft = session.draft;
    if (
      draft.latitude == null ||
      draft.longitude == null ||
      !draft.category ||
      !draft.description ||
      !draft.radiusMeters
    ) {
      setSession(userId, { step: 'idle' });
      await ctx.reply('Черновик сброшен. Начните заново: «Мне нужно».', {
        reply_markup: mainKeyboard(),
      });
      return;
    }
    const order = addOrder({
      category: draft.category,
      description: draft.description,
      destinationText: dest,
      latitude: draft.latitude,
      longitude: draft.longitude,
      radiusMeters: draft.radiusMeters,
      creatorTelegramId: userId,
      creatorName: ctx.from.first_name,
      creatorUsername: ctx.from.username ?? null,
      expiresInMinutes: 30,
    });
    setSession(userId, { step: 'idle' });
    await postToServiceChat(order);
    await ctx.reply(
      `Заявка создана.\n${CATEGORY_LABELS[draft.category]} · ${RADIUS_LABELS[draft.radiusMeters]}\n${draft.description}`,
      { reply_markup: mainKeyboard() },
    );
    return;
  }
});

if (WEBHOOK_SECRET) {
  app.post('/bot/webhook', async (req, reply) => {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== WEBHOOK_SECRET) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    return webhookCallback(bot, 'fastify')(req, reply);
  });
}

const start = async () => {
  if (BOT_WEBHOOK_URL) {
    await bot.api.setWebhook(BOT_WEBHOOK_URL, {
      secret_token: WEBHOOK_SECRET || undefined,
    });
    console.log('Webhook →', BOT_WEBHOOK_URL);
  } else {
    bot.start({ onStart: (i) => console.log(`Bot @${i.username} polling`) });
  }
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API :${PORT}`);
  console.log(
    `nativeClient=${NATIVE_CLIENT_SECRET ? 'HMAC on' : 'off'}, service chat=${serviceChatId || 'off'}`,
  );
  console.warn('JSON-store is single-process only — do not scale bot replicas');
  if (serviceChatId) console.log('Service chat:', serviceChatId);
  else console.warn('Set SERVICE_CHAT_ID to enable chronicle in service group');
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
