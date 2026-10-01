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
import { validateInitData } from './telegram-auth.js';
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
import { formatServiceMessage, toPublicCard } from './messages.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVICE_CHAT_ID = process.env.SERVICE_CHAT_ID; // e.g. -100xxxxxxxxxx
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://example.com';
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL;

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN required');
if (!SERVICE_CHAT_ID) {
  console.warn('SERVICE_CHAT_ID not set — posting to service chat disabled until configured');
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
  if (order.serviceChatId && order.serviceMessageId) {
    try {
      await bot.api.editMessageText(
        order.serviceChatId,
        order.serviceMessageId,
        formatServiceMessage(order, false),
        { reply_markup: { inline_keyboard: [] } },
      );
    } catch (e) {
      console.error('editMessage failed', e);
    }
  }
}

function userFromInit(initData: string) {
  return validateInitData(initData, TOKEN!);
}

// ── Commands ──
bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply(
    'Я рядом\n\nЗаявки рядом с вами. Можно работать прямо в боте или открыть Mini App.',
    { reply_markup: mainKeyboard() },
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('Откройте Mini App:', {
    reply_markup: new InlineKeyboard().webApp('Открыть', WEB_APP_URL),
  });
});

bot.command('cancel', async (ctx) => {
  if (ctx.from) setSession(ctx.from.id, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

// ── Thin client: reply keyboard ──
bot.hears('Мне нужно', async (ctx) => {
  if (!ctx.from) return;
  setSession(ctx.from.id, { step: 'create_location' });
  await ctx.reply('Отправьте геолокацию — она нужна только для поиска рядом.', {
    reply_markup: locationKeyboard(),
  });
});

bot.hears('Я могу', async (ctx) => {
  if (!ctx.from) return;
  setSession(ctx.from.id, { step: 'nearby_location' });
  await ctx.reply('Отправьте геолокацию, чтобы увидеть заявки рядом.', {
    reply_markup: locationKeyboard(),
  });
});

bot.hears('Мои заявки', async (ctx) => {
  if (!ctx.from) return;
  const items = listTakenBy(ctx.from.id);
  if (items.length === 0) {
    await ctx.reply('У вас нет взятых заявок.', { reply_markup: mainKeyboard() });
    return;
  }
  for (const o of items) {
    await ctx.reply(toPublicCard(o), {
      reply_markup: new InlineKeyboard().text('Завершить', `complete:${o.id}`),
    });
  }
});

bot.hears('Mini App', async (ctx) => {
  await ctx.reply('Mini App:', {
    reply_markup: new InlineKeyboard().webApp('Открыть', WEB_APP_URL),
  });
});

bot.hears(['Отмена', '« Отмена'], async (ctx) => {
  if (ctx.from) setSession(ctx.from.id, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.on('message:location', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const loc = ctx.message.location;
  if (!loc) return;
  const s = getSession(userId);

  if (s.step === 'create_location') {
    setSession(userId, {
      step: 'create_category',
      draft: { latitude: loc.latitude, longitude: loc.longitude },
    });
    await ctx.reply('Выберите категорию:', { reply_markup: categoryKeyboard() });
    return;
  }

  if (s.step === 'nearby_location') {
    setSession(userId, {
      step: 'nearby_radius',
      latitude: loc.latitude,
      longitude: loc.longitude,
    });
    await ctx.reply('Радиус поиска:', { reply_markup: radiusKeyboard('nrad') });
    return;
  }
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message.text?.trim();
  if (!text) return;
  const s = getSession(userId);

  if (s.step === 'create_description') {
    const draft = { ...s.draft, description: text };
    setSession(userId, { step: 'create_radius', draft });
    await ctx.reply('Радиус видимости заявки:', { reply_markup: radiusKeyboard('crad') });
    return;
  }

  if (s.step === 'create_destination') {
    await finishCreate(ctx, userId, { ...s.draft, destinationText: text || undefined });
    return;
  }
});

async function finishCreate(
  ctx: { reply: (t: string, extra?: object) => Promise<unknown>; from?: { id: number; first_name?: string; username?: string } },
  userId: number,
  draft: CreateDraft,
) {
  if (
    draft.latitude == null ||
    draft.longitude == null ||
    !draft.category ||
    !draft.description ||
    !draft.radiusMeters
  ) {
    setSession(userId, { step: 'idle' });
    await ctx.reply('Не хватает данных. Начните заново: «Мне нужно».', {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  pruneExpired();
  const order = addOrder({
    category: draft.category,
    description: draft.description,
    latitude: draft.latitude,
    longitude: draft.longitude,
    destinationText: draft.destinationText,
    radiusMeters: draft.radiusMeters,
    creatorTelegramId: userId,
    creatorName: ctx.from?.first_name || 'Пользователь',
    creatorUsername: ctx.from?.username ?? null,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });

  setSession(userId, { step: 'idle' });
  await postToServiceChat(order);
  await ctx.reply(`Заявка создана.\n${toPublicCard(order)}`, {
    reply_markup: mainKeyboard(),
  });
}

bot.callbackQuery('cancel', async (ctx) => {
  if (ctx.from) setSession(ctx.from.id, { step: 'idle' });
  await ctx.answerCallbackQuery();
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const s = getSession(userId);
  if (s.step !== 'create_category') {
    await ctx.answerCallbackQuery({ text: 'Устарело', show_alert: true });
    return;
  }
  const cat = ctx.match![1] as (typeof CATEGORIES)[number];
  if (!CATEGORIES.includes(cat)) {
    await ctx.answerCallbackQuery({ text: 'Неизвестная категория', show_alert: true });
    return;
  }
  setSession(userId, {
    step: 'create_description',
    draft: { ...s.draft, category: cat },
  });
  await ctx.answerCallbackQuery();
  await ctx.reply('Кратко опишите, что нужно (текстом):');
});

bot.callbackQuery(/^crad:(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const s = getSession(userId);
  if (s.step !== 'create_radius') {
    await ctx.answerCallbackQuery({ text: 'Устарело', show_alert: true });
    return;
  }
  const radiusMeters = Number(ctx.match![1]);
  if (!RADII.includes(radiusMeters as (typeof RADII)[number])) {
    await ctx.answerCallbackQuery({ text: 'Неверный радиус', show_alert: true });
    return;
  }
  setSession(userId, {
    step: 'create_destination',
    draft: { ...s.draft, radiusMeters },
  });
  await ctx.answerCallbackQuery();
  await ctx.reply(
    'Пункт назначения (необязательно). Напишите текст или «-» чтобы пропустить:',
  );
});

bot.callbackQuery(/^nrad:(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const s = getSession(userId);
  if (s.step !== 'nearby_radius') {
    await ctx.answerCallbackQuery({ text: 'Устарело', show_alert: true });
    return;
  }
  const radiusMeters = Number(ctx.match![1]);
  await ctx.answerCallbackQuery();
  pruneExpired();
  const all = listOrders().filter((o) => o.status === 'OPEN');
  const items = all
    .map((o) => ({
      order: o,
      d: distanceMeters(s.latitude, s.longitude, o.latitude, o.longitude),
    }))
    .filter((x) => x.d <= radiusMeters)
    .sort((a, b) => a.d - b.d)
    .slice(0, 20);

  setSession(userId, { step: 'idle' });
  if (items.length === 0) {
    await ctx.reply('Рядом открытых заявок нет.', { reply_markup: mainKeyboard() });
    return;
  }
  for (const { order: o, d } of items) {
    const km = d < 1000 ? `${Math.round(d)} м` : `${(d / 1000).toFixed(1)} км`;
    await ctx.reply(`${toPublicCard(o)}\n📍 ~${km}`, {
      reply_markup: new InlineKeyboard().text('Взять', `take:${o.id}`),
    });
  }
  await ctx.reply('Готово.', { reply_markup: mainKeyboard() });
});

bot.callbackQuery(/^take:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const orderId = ctx.match![1];
  const updated = tryTake(orderId, userId, ctx.from?.first_name || 'Исполнитель');
  if (!updated) {
    await ctx.answerCallbackQuery({ text: 'Уже недоступна', show_alert: true });
    return;
  }
  await stripGpsFromService(updated);
  await ctx.answerCallbackQuery({ text: 'Взято' });
  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Вашу заявку взяли.\n${updated.description}`,
    );
  } catch {
    /* ignore */
  }
  await ctx.reply(`Вы взяли заявку.\n${toPublicCard(updated)}`, {
    reply_markup: new InlineKeyboard().text('Завершить', `complete:${updated.id}`),
  });
});

bot.callbackQuery(/^complete:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const orderId = ctx.match![1];
  const updated = tryComplete(orderId, userId);
  if (!updated) {
    await ctx.answerCallbackQuery({ text: 'Нельзя завершить', show_alert: true });
    return;
  }
  await stripGpsFromService(updated);
  await ctx.answerCallbackQuery({ text: 'Выполнено' });
  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Заявка выполнена.\n${updated.description}`,
    );
  } catch {
    /* ignore */
  }
  await ctx.reply('Заявка отмечена выполненной.', { reply_markup: mainKeyboard() });
});

bot.catch((err) => console.error('Bot error', err));

// ── Mini App API ──
const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

app.post('/api/auth', async (req, reply) => {
  const body = z.object({ initData: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(body.data.initData);
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
  initData: z.string().min(1),
  category: z.enum(CATEGORIES),
  description: z.string().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  destinationText: z.string().max(300).optional(),
  radiusMeters: z.number().int().positive(),
  expiresInMinutes: z.number().int().min(5).max(240).default(30),
});

app.post('/api/orders', async (req, reply) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(parsed.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  pruneExpired();
  const order = addOrder({
    category: parsed.data.category,
    description: parsed.data.description,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    destinationText: parsed.data.destinationText,
    radiusMeters: parsed.data.radiusMeters,
    creatorTelegramId: user.id,
    creatorName: user.first_name || 'Пользователь',
    creatorUsername: user.username ?? null,
    expiresAt: new Date(Date.now() + parsed.data.expiresInMinutes * 60_000).toISOString(),
  });
  await postToServiceChat(order);
  return reply.send({ id: order.id, status: order.status });
});

app.post('/api/orders/nearby', async (req, reply) => {
  const body = z
    .object({
      initData: z.string().min(1),
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().positive().default(5000),
    })
    .safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(body.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  pruneExpired();
  const { latitude, longitude, radiusMeters } = body.data;
  const items = listOrders()
    .filter((o) => o.status === 'OPEN' && o.creatorTelegramId !== user.id)
    .map((o) => ({
      id: o.id,
      category: o.category,
      description: o.description,
      destinationText: o.destinationText,
      creatorName: o.creatorName,
      distanceMeters: Math.round(distanceMeters(latitude, longitude, o.latitude, o.longitude)),
    }))
    .filter((x) => x.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 50);
  return reply.send({ items });
});

const orderIdSchema = z.object({
  initData: z.string().min(1),
  orderId: z.string().uuid(),
});

app.post('/api/orders/take', async (req, reply) => {
  const parsed = orderIdSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(parsed.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const updated = tryTake(
    parsed.data.orderId,
    user.id,
    user.first_name || 'Исполнитель',
  );
  if (!updated) {
    return reply.status(409).send({
      error: 'ORDER_NOT_AVAILABLE',
      message: 'Заявка уже недоступна',
    });
  }
  await stripGpsFromService(updated);

  let creatorNotified = false;
  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Вашу заявку взяли.\n${updated.description}`,
    );
    creatorNotified = true;
  } catch {
    /* ignore */
  }

  return reply.send({
    id: updated.id,
    status: 'TAKEN',
    message: 'Заявка взята',
    notifications: { creatorNotified, takerNotified: true },
  });
});

app.post('/api/orders/mine', async (req, reply) => {
  const body = z.object({ initData: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(body.data.initData);
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

app.post('/api/orders/complete', async (req, reply) => {
  const parsed = orderIdSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(parsed.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const updated = tryComplete(parsed.data.orderId, user.id);
  if (!updated) {
    return reply.status(409).send({
      error: 'ORDER_NOT_AVAILABLE',
      message: 'Заявку нельзя завершить',
    });
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
  if (serviceChatId) console.log('Service chat:', serviceChatId);
  else console.warn('Set SERVICE_CHAT_ID to enable chronicle in service group');
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
