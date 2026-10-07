/**
 * Ya Ryadom — Mini App + thin Telegram bot client.
 *
 * Source of truth: JSON store. Service chat = operator chronicle.
 * Native Android client supported via HMAC (NATIVE_CLIENT_SECRET).
 */

import Fastify from 'fastify';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { z } from 'zod';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { haversineMeters } from './geo.js';
import { loadOrders, saveOrders, tryTake, type Order } from './store.js';
import { validateInitData, type TgUser } from './telegram-auth.js';
import * as messages from './messages.js';

const TOKEN = process.env.TOKEN!;
const WEB_APP_URL = process.env.WEB_APP_URL || '';
const SERVICE_CHAT_ID = process.env.SERVICE_CHAT_ID ? Number(process.env.SERVICE_CHAT_ID) : 0;
const NATIVE_CLIENT_SECRET = process.env.NATIVE_CLIENT_SECRET || '';
const PORT = Number(process.env.PORT || 3000);

/** Shared category list — keep in sync with Mini App and Android */
const CATEGORIES = ['RIDE', 'DELIVERY', 'REPAIR', 'CLEANING', 'SHOPPING', 'COMPUTER', 'HELP', 'RENTAL', 'OTHER'] as const;

if (!TOKEN) {
  console.error('TOKEN is required');
  process.exit(1);
}

const bot = new Bot(TOKEN);
const app = Fastify({ logger: true });

function verifyNativeSignature(
  userId: number,
  firstName: string,
  timestamp: number,
  signature: string,
  secret: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;
  const payload = `${userId}:${firstName}:${timestamp}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function resolveUser(body: any): TgUser | null {
  if (body.initData) {
    return validateInitData(body.initData, TOKEN);
  }
  if (
    body.nativeClient === true &&
    body.userId &&
    body.firstName &&
    body.timestamp &&
    body.signature &&
    NATIVE_CLIENT_SECRET
  ) {
    if (!verifyNativeSignature(body.userId, body.firstName, body.timestamp, body.signature, NATIVE_CLIENT_SECRET)) {
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

const nativeFields = {
  nativeClient: z.literal(true).optional(),
  userId: z.number().int().positive().optional(),
  firstName: z.string().min(1).max(128).optional(),
  username: z.string().max(64).nullable().optional(),
  timestamp: z.number().int().positive().optional(),
  signature: z.string().min(64).max(128).optional(),
  initData: z.string().min(1).optional(),
};

const createSchema = z.object({
  ...nativeFields,
  category: z.enum(CATEGORIES),
  description: z.string().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  destinationText: z.string().max(300).optional(),
  radiusMeters: z.number(),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
});

const nearbySchema = z.object({
  ...nativeFields,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().default(5000),
});

const takeSchema = z.object({
  ...nativeFields,
  orderId: z.string().uuid(),
});

const orderIdSchema = z.object({
  ...nativeFields,
  orderId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

/** Login / session check for Mini App */
app.post('/api/auth', async (req, reply) => {
  const parsed = z.object({ ...nativeFields }).safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  return {
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
    },
  };
});

app.post('/api/orders', async (req, reply) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const data = parsed.data;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + data.expiresInMinutes * 60_000);

  const order: Order = {
    id: randomUUID(),
    status: 'OPEN',
    category: data.category,
    description: data.description,
    latitude: data.latitude,
    longitude: data.longitude,
    destinationText: data.destinationText,
    radiusMeters: data.radiusMeters,
    creatorId: user.id,
    creatorName: user.first_name,
    creatorUsername: user.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);

  if (SERVICE_CHAT_ID) {
    try {
      const text = messages.formatNewOrder(order);
      const msg = await bot.api.sendMessage(SERVICE_CHAT_ID, text, { parse_mode: 'HTML' });
      order.serviceChatId = SERVICE_CHAT_ID;
      order.serviceMessageId = msg.message_id;
      saveOrders(orders);
    } catch (e) {
      console.error('service chat post failed', e);
    }
  }

  return { id: order.id, status: order.status, expiresAt: order.expiresAt };
});

app.post('/api/orders/nearby', async (req, reply) => {
  const parsed = nearbySchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const { latitude, longitude, radiusMeters } = parsed.data;
  const now = Date.now();
  const orders = loadOrders().filter(
    (o) =>
      o.status === 'OPEN' &&
      new Date(o.expiresAt).getTime() > now &&
      o.creatorId !== user.id
  );

  // Visibility = intersection of order radius and searcher radius
  const items = orders
    .map((o) => {
      const dist = haversineMeters(latitude, longitude, o.latitude, o.longitude);
      return { order: o, dist };
    })
    .filter((x) => x.dist <= Math.min(radiusMeters, x.order.radiusMeters))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 30)
    .map(({ order: o, dist }) => ({
      id: o.id,
      category: o.category,
      description: o.description,
      destinationText: o.destinationText,
      distanceMeters: Math.round(dist),
      status: o.status,
      creatorName: o.creatorName,
    }));

  return { items };
});

app.post('/api/orders/take', async (req, reply) => {
  const parsed = takeSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const result = tryTake(parsed.data.orderId, {
    id: user.id,
    name: user.first_name,
    username: user.username,
  });

  if (!result.ok) {
    return reply.status(409).send({ error: result.reason || 'TAKE_FAILED' });
  }

  const order = result.order!;

  if (order.serviceChatId && order.serviceMessageId) {
    try {
      const text = messages.formatTakenOrder(order);
      await bot.api.editMessageText(order.serviceChatId, order.serviceMessageId, text, {
        parse_mode: 'HTML',
      });
    } catch (e) {
      console.error('edit service message failed', e);
    }
  }

  let creatorNotified = false;
  try {
    await bot.api.sendMessage(
      order.creatorId,
      `Вашу заявку взял ${user.first_name}${user.username ? ' @' + user.username : ''}`
    );
    creatorNotified = true;
  } catch {}

  return {
    id: order.id,
    status: order.status,
    message: 'Заявка взята',
    notifications: { creatorNotified, takerNotified: false },
  };
});

app.post('/api/orders/mine', async (req, reply) => {
  const parsed = z.object({ ...nativeFields }).safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const items = loadOrders()
    .filter((o) => o.takerId === user.id && o.status === 'TAKEN')
    .map((o) => ({
      id: o.id,
      category: o.category,
      description: o.description,
      destinationText: o.destinationText,
      status: o.status,
      creatorName: o.creatorName,
      creatorUsername: o.creatorUsername,
    }));

  return { items };
});

app.post('/api/orders/complete', async (req, reply) => {
  const parsed = orderIdSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });

  const user = resolveUser(parsed.data);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  const orders = loadOrders();
  const order = orders.find((o) => o.id === parsed.data.orderId);
  if (!order || order.takerId !== user.id || order.status !== 'TAKEN') {
    return reply.status(404).send({ error: 'NOT_FOUND' });
  }

  order.status = 'COMPLETED';
  order.completedAt = new Date().toISOString();
  saveOrders(orders);

  try {
    await bot.api.sendMessage(order.creatorId, `Заявка «${order.description.slice(0, 40)}» выполнена.`);
  } catch {}

  return { id: order.id, status: order.status, message: 'Заявка выполнена' };
});

app.get('/health', async () => ({ ok: true }));

// ---------------------------------------------------------------------------
// Bot handlers
// ---------------------------------------------------------------------------

const dialogs = new Map<number, { step: string; data: any }>();

bot.command('start', async (ctx) => {
  const kb = new Keyboard()
    .text('Мне нужно')
    .text('Я могу')
    .row()
    .text('Мои заявки')
    .resized();
  if (WEB_APP_URL) {
    kb.row().webApp('Mini App', WEB_APP_URL);
  }
  await ctx.reply('Я рядом — локальные заявки.\nВыберите действие:', { reply_markup: kb });
});

bot.hears('Мне нужно', async (ctx) => {
  dialogs.set(ctx.from!.id, { step: 'need_location', data: {} });
  await ctx.reply('Отправьте геолокацию (кнопка «📍»):', {
    reply_markup: new Keyboard().requestLocation('📍 Отправить геолокацию').resized().oneTime(),
  });
});

bot.hears('Я могу', async (ctx) => {
  dialogs.set(ctx.from!.id, { step: 'can_location', data: {} });
  await ctx.reply('Отправьте геолокацию для поиска рядом:', {
    reply_markup: new Keyboard().requestLocation('📍 Отправить геолокацию').resized().oneTime(),
  });
});

bot.hears('Мои заявки', async (ctx) => {
  const items = loadOrders().filter((o) => o.takerId === ctx.from!.id && o.status === 'TAKEN');
  if (!items.length) {
    await ctx.reply('У вас нет активных взятых заявок.');
    return;
  }
  for (const o of items) {
    const kb = new InlineKeyboard().text('Завершить', `complete:${o.id}`);
    await ctx.reply(`📋 ${o.category}\n${o.description}`, { reply_markup: kb });
  }
});

bot.on('message:location', async (ctx) => {
  const state = dialogs.get(ctx.from!.id);
  if (!state) return;

  const { latitude, longitude } = ctx.message.location;

  if (state.step === 'need_location') {
    state.data.lat = latitude;
    state.data.lng = longitude;
    state.step = 'need_category';
    const kb = new InlineKeyboard();
    // Unified categories
    CATEGORIES.forEach((c) => kb.text(c, `cat:${c}`).row());
    await ctx.reply('Выберите категорию:', { reply_markup: kb });
  } else if (state.step === 'can_location') {
    const now = Date.now();
    const orders = loadOrders().filter(
      (o) => o.status === 'OPEN' && new Date(o.expiresAt).getTime() > now && o.creatorId !== ctx.from!.id
    );
    const searchRadius = 5000;
    const nearby = orders
      .map((o) => ({ o, d: haversineMeters(latitude, longitude, o.latitude, o.longitude) }))
      .filter((x) => x.d <= Math.min(searchRadius, x.o.radiusMeters))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);

    if (!nearby.length) {
      await ctx.reply('Рядом нет открытых заявок.');
      dialogs.delete(ctx.from!.id);
      return;
    }

    for (const { o, d } of nearby) {
      const kb = new InlineKeyboard().text('Взять', `take:${o.id}`);
      await ctx.reply(
        `📍 ${Math.round(d)} м · ${o.category}\n${o.description}\nот ${o.creatorName}`,
        { reply_markup: kb }
      );
    }
    dialogs.delete(ctx.from!.id);
  }
});

bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
  const state = dialogs.get(ctx.from!.id);
  if (!state || state.step !== 'need_category') return;
  state.data.category = ctx.match![1];
  state.step = 'need_description';
  await ctx.answerCallbackQuery();
  await ctx.reply('Опишите, что нужно (текстом):');
});

bot.on('message:text', async (ctx) => {
  const state = dialogs.get(ctx.from!.id);
  if (!state || state.step !== 'need_description') return;

  const description = ctx.message.text.trim();
  if (description.length < 3) {
    await ctx.reply('Слишком коротко. Напишите подробнее.');
    return;
  }

  const now = new Date();
  const order: Order = {
    id: randomUUID(),
    status: 'OPEN',
    category: state.data.category || 'OTHER',
    description,
    latitude: state.data.lat,
    longitude: state.data.lng,
    radiusMeters: 5000,
    creatorId: ctx.from!.id,
    creatorName: ctx.from!.first_name,
    creatorUsername: ctx.from!.username,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  };

  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);

  if (SERVICE_CHAT_ID) {
    try {
      const text = messages.formatNewOrder(order);
      const msg = await bot.api.sendMessage(SERVICE_CHAT_ID, text, { parse_mode: 'HTML' });
      order.serviceChatId = SERVICE_CHAT_ID;
      order.serviceMessageId = msg.message_id;
      saveOrders(orders);
    } catch {}
  }

  dialogs.delete(ctx.from!.id);
  await ctx.reply('Заявка создана! Она будет видна рядом в радиусе 5 км.');
});

bot.callbackQuery(/^take:(.+)$/, async (ctx) => {
  const orderId = ctx.match![1];
  const result = tryTake(orderId, {
    id: ctx.from!.id,
    name: ctx.from!.first_name,
    username: ctx.from!.username,
  });

  await ctx.answerCallbackQuery();
  if (!result.ok) {
    await ctx.reply(result.reason === 'ALREADY_TAKEN' ? 'Уже взята кем-то другим.' : 'Не удалось взять.');
    return;
  }

  const order = result.order!;
  if (order.serviceChatId && order.serviceMessageId) {
    try {
      await bot.api.editMessageText(
        order.serviceChatId,
        order.serviceMessageId,
        messages.formatTakenOrder(order),
        { parse_mode: 'HTML' }
      );
    } catch {}
  }

  try {
    await bot.api.sendMessage(order.creatorId, `Вашу заявку взял ${ctx.from!.first_name}`);
  } catch {}

  await ctx.reply('Заявка взята. Свяжитесь с заказчиком и выполните.');
});

bot.callbackQuery(/^complete:(.+)$/, async (ctx) => {
  const orderId = ctx.match![1];
  const orders = loadOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order || order.takerId !== ctx.from!.id || order.status !== 'TAKEN') {
    await ctx.answerCallbackQuery({ text: 'Не найдено' });
    return;
  }
  order.status = 'COMPLETED';
  order.completedAt = new Date().toISOString();
  saveOrders(orders);
  await ctx.answerCallbackQuery({ text: 'Готово' });
  await ctx.editMessageText(`✅ Выполнено: ${order.description.slice(0, 60)}`);
  try {
    await bot.api.sendMessage(order.creatorId, `Заявка «${order.description.slice(0, 40)}» выполнена.`);
  } catch {}
});

async function start() {
  app.listen({ port: PORT, host: '0.0.0.0' });
  bot.start({ onStart: () => console.log('Bot started') });
  console.log(`API on :${PORT}, nativeClient=${!!NATIVE_CLIENT_SECRET}, service chat=${SERVICE_CHAT_ID || 'off'}`);
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
