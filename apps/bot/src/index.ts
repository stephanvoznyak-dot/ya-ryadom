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

// ── Команды и тонкий клиент ────────────────────────────────

bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply(
    'Я рядом\n\n' +
      'Заявки рядом с вами. Можно работать прямо в боте (тонкий клиент) или открыть Mini App.\n\n' +
      '• «Мне нужно» — создать заявку\n' +
      '• «Я могу» — посмотреть ближайшие и взять\n' +
      '• «Мои заявки» — ваши взятые заявки',
    { reply_markup: mainKeyboard() },
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('Открыть Mini App:', {
    reply_markup: new InlineKeyboard().webApp('Открыть «Я рядом»', WEB_APP_URL),
  });
});

bot.command('cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.hears('Мне нужно', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setSession(userId, { step: 'create_location' });
  await ctx.reply(
    'Создание заявки.\n\nОтправьте вашу текущую геолокацию (кнопка ниже). Координаты используются только для поиска рядом и не показываются другим пользователям.',
    { reply_markup: locationKeyboard() },
  );
});

bot.hears('Я могу', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setSession(userId, { step: 'nearby_location' });
  await ctx.reply(
    'Поиск заявок рядом.\n\nОтправьте вашу текущую геолокацию.',
    { reply_markup: locationKeyboard() },
  );
});

bot.hears('Мои заявки', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setSession(userId, { step: 'idle' });
  pruneExpired();
  const items = listTakenBy(userId);
  if (items.length === 0) {
    await ctx.reply('У вас нет активных взятых заявок.', { reply_markup: mainKeyboard() });
    return;
  }
  for (const o of items) {
    const text =
      `📋 ${CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category}\n` +
      `${o.description}\n` +
      (o.destinationText ? `→ ${o.destinationText}\n` : '') +
      `Заказчик: ${o.creatorName}${o.creatorUsername ? ` @${o.creatorUsername}` : ''}`;
    await ctx.reply(text, {
      reply_markup: new InlineKeyboard().text('Завершить', `complete:${o.id}`),
    });
  }
  await ctx.reply('Выберите действие или вернитесь в меню.', { reply_markup: mainKeyboard() });
});

bot.hears('Mini App', async (ctx) => {
  await ctx.reply('Открыть приложение:', {
    reply_markup: new InlineKeyboard().webApp('Открыть «Я рядом»', WEB_APP_URL),
  });
});

bot.hears(['Отмена', '« Отмена'], async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.on('message:location', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const loc = ctx.message.location;
  const session = getSession(userId);

  if (session.step === 'create_location') {
    setSession(userId, {
      step: 'create_category',
      draft: { latitude: loc.latitude, longitude: loc.longitude },
    });
    await ctx.reply('Геолокация получена. Выберите категорию:', {
      reply_markup: categoryKeyboard(),
    });
    return;
  }

  if (session.step === 'nearby_location') {
    setSession(userId, {
      step: 'nearby_radius',
      latitude: loc.latitude,
      longitude: loc.longitude,
    });
    await ctx.reply('Геолокация получена. Выберите радиус поиска:', {
      reply_markup: radiusKeyboard('nrad'),
    });
    return;
  }

  await ctx.reply('Геолокация сейчас не требуется. Используйте меню.', {
    reply_markup: mainKeyboard(),
  });
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message.text.trim();
  if (['Мне нужно', 'Я могу', 'Мои заявки', 'Mini App', 'Отмена', '« Отмена'].includes(text)) {
    return;
  }
  if (text.startsWith('/')) return;

  const session = getSession(userId);

  if (session.step === 'create_description') {
    if (text.length < 3 || text.length > 500) {
      await ctx.reply('Описание должно быть от 3 до 500 символов. Повторите:');
      return;
    }
    setSession(userId, {
      step: 'create_radius',
      draft: { ...session.draft, description: text },
    });
    await ctx.reply('Выберите радиус действия заявки:', {
      reply_markup: radiusKeyboard('crad'),
    });
    return;
  }

  if (session.step === 'create_destination') {
    const dest = text === '-' || text.toLowerCase() === 'нет' ? undefined : text.slice(0, 300);
    const draft = { ...session.draft, destinationText: dest };
    await finishCreate(ctx, userId, draft);
    return;
  }
});

async function finishCreate(
  ctx: { reply: (t: string, o?: object) => Promise<unknown>; from?: { id: number; first_name: string; username?: string } },
  userId: number,
  draft: CreateDraft,
) {
  if (
    draft.latitude == null ||
    draft.longitude == null ||
    !draft.category ||
    !draft.description ||
    draft.radiusMeters == null
  ) {
    setSession(userId, { step: 'idle' });
    await ctx.reply('Данные заявки неполные. Начните заново: «Мне нужно».', {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  const from = ctx.from!;
  const order = addOrder({
    category: draft.category,
    description: draft.description,
    destinationText: draft.destinationText,
    latitude: draft.latitude,
    longitude: draft.longitude,
    radiusMeters: draft.radiusMeters,
    creatorTelegramId: userId,
    creatorName: from.first_name,
    creatorUsername: from.username ?? null,
    expiresInMinutes: 30,
  });

  await postToServiceChat(order);
  setSession(userId, { step: 'idle' });

  await ctx.reply(
    `Заявка создана.\n\n` +
      `📋 ${CATEGORY_LABELS[draft.category]}\n` +
      `${draft.description}\n` +
      (draft.destinationText ? `→ ${draft.destinationText}\n` : '') +
      `Радиус: ${RADIUS_LABELS[draft.radiusMeters]}\n` +
      `Действует 30 минут.`,
    { reply_markup: mainKeyboard() },
  );
}

bot.callbackQuery('cancel', async (ctx) => {
  const userId = ctx.from.id;
  setSession(userId, { step: 'idle' });
  await ctx.answerCallbackQuery();
  await ctx.reply('Отменено.', { reply_markup: mainKeyboard() });
});

bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step !== 'create_category') {
    await ctx.answerCallbackQuery({ text: 'Сессия устарела', show_alert: true });
    return;
  }
  const cat = ctx.match![1] as (typeof CATEGORIES)[number];
  if (!CATEGORIES.includes(cat)) {
    await ctx.answerCallbackQuery({ text: 'Неизвестная категория', show_alert: true });
    return;
  }
  setSession(userId, {
    step: 'create_description',
    draft: { ...session.draft, category: cat },
  });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Категория: ${CATEGORY_LABELS[cat]}\n\nНапишите краткое описание заявки (что нужно):`,
  );
});

bot.callbackQuery(/^crad:(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step !== 'create_radius') {
    await ctx.answerCallbackQuery({ text: 'Сессия устарела', show_alert: true });
    return;
  }
  const radius = Number(ctx.match![1]);
  if (!(RADII as readonly number[]).includes(radius)) {
    await ctx.answerCallbackQuery({ text: 'Неверный радиус', show_alert: true });
    return;
  }
  setSession(userId, {
    step: 'create_destination',
    draft: { ...session.draft, radiusMeters: radius },
  });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Радиус: ${RADIUS_LABELS[radius]}\n\n` +
      'Укажите пункт назначения или адрес (текстом), либо отправьте «-» / «нет», если не нужно:',
  );
});

bot.callbackQuery(/^nrad:(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step !== 'nearby_radius') {
    await ctx.answerCallbackQuery({ text: 'Сессия устарела', show_alert: true });
    return;
  }
  const radiusMeters = Number(ctx.match![1]);
  if (!(RADII as readonly number[]).includes(radiusMeters)) {
    await ctx.answerCallbackQuery({ text: 'Неверный радиус', show_alert: true });
    return;
  }

  pruneExpired();
  const { latitude, longitude } = session;
  const now = Date.now();

  const items = listOrders()
    .filter((o) => {
      if (o.status !== 'OPEN') return false;
      if (new Date(o.expiresAt).getTime() <= now) return false;
      if (o.creatorTelegramId === userId) return false;
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return dist <= radiusMeters && dist <= o.radiusMeters;
    })
    .map((o) => {
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return { order: o, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 20);

  setSession(userId, { step: 'idle' });
  await ctx.answerCallbackQuery();

  if (items.length === 0) {
    await ctx.editMessageText(
      `Рядом (в радиусе ${RADIUS_LABELS[radiusMeters]}) открытых заявок не найдено.`,
    );
    await ctx.reply('Попробуйте другой радиус или позже.', { reply_markup: mainKeyboard() });
    return;
  }

  await ctx.editMessageText(
    `Найдено заявок: ${items.length} (радиус ${RADIUS_LABELS[radiusMeters]}).`,
  );

  for (const { order: o, dist } of items) {
    const card =
      `📋 ${CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category}\n` +
      `${o.description}\n` +
      (o.destinationText ? `→ ${o.destinationText}\n` : '') +
      `≈ ${dist < 1000 ? `${dist} м` : `${(dist / 1000).toFixed(1)} км`}\n` +
      `От: ${o.creatorName}`;
    await ctx.reply(card, {
      reply_markup: new InlineKeyboard().text('Взять', `take:${o.id}`),
    });
  }
  await ctx.reply('Выберите заявку или вернитесь в меню.', { reply_markup: mainKeyboard() });
});

bot.callbackQuery(/^take:(.+)$/, async (ctx) => {
  const orderId = ctx.match![1];
  const from = ctx.from;
  if (!from) return ctx.answerCallbackQuery({ text: 'Ошибка', show_alert: true });

  pruneExpired();
  const before = getOrder(orderId);
  if (before && before.creatorTelegramId === from.id) {
    return ctx.answerCallbackQuery({ text: 'Это ваша заявка', show_alert: true });
  }

  const updated = tryTake(orderId, {
    telegramId: from.id,
    name: from.first_name,
    username: from.username ?? null,
  });
  if (!updated) {
    return ctx.answerCallbackQuery({ text: 'Уже недоступна', show_alert: true });
  }
  const order = updated;

  await stripGpsFromService(updated);
  await ctx.answerCallbackQuery({ text: 'Заявка взята' });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    /* */
  }

  try {
    await bot.api.sendMessage(
      order.creatorTelegramId,
      `Вашу заявку взяли!\n${order.description}\nИсполнитель: ${from.first_name}${from.username ? ` @${from.username}` : ''}`,
    );
  } catch {
    /* */
  }
  try {
    await bot.api.sendMessage(
      from.id,
      `Вы взяли заявку!\n${order.description}\nЗаказчик: ${order.creatorName}${order.creatorUsername ? ` @${order.creatorUsername}` : ''}\n\nКогда выполните — откройте «Мои заявки» и нажмите «Завершить».`,
      { reply_markup: mainKeyboard() },
    );
  } catch {
    /* */
  }
});

bot.callbackQuery(/^complete:(.+)$/, async (ctx) => {
  const orderId = ctx.match![1];
  const userId = ctx.from.id;

  const updated = tryComplete(orderId, userId);
  if (!updated) {
    return ctx.answerCallbackQuery({
      text: 'Заявку нельзя завершить',
      show_alert: true,
    });
  }

  await stripGpsFromService(updated);
  await ctx.answerCallbackQuery({ text: 'Заявка выполнена' });
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    /* */
  }

  try {
    await bot.api.sendMessage(
      updated.creatorTelegramId,
      `Заявка выполнена.\n${updated.description}`,
    );
  } catch {
    /* */
  }

  await ctx.reply('Заявка отмечена как выполненная.', { reply_markup: mainKeyboard() });
});

bot.catch((err) => console.error('Bot error', err));

// ── Mini API (для Mini App) ────────────────────────────────

const createSchema = z.object({
  initData: z.string().min(1),
  category: z.enum(CATEGORIES),
  description: z.string().min(3).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  destinationText: z.string().max(300).optional(),
  radiusMeters: z.number().refine((v) => (RADII as readonly number[]).includes(v)),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
});

const nearbySchema = z.object({
  initData: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().refine((v) => (RADII as readonly number[]).includes(v)).default(5000),
});

const takeSchema = z.object({
  initData: z.string().min(1),
  orderId: z.string().uuid(),
});

function userFromInit(initData: string) {
  const u = validateInitData(initData, TOKEN!);
  if (!u) return null;
  return u;
}

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

app.post('/api/auth', async (req, reply) => {
  const body = z.object({ initData: z.string() }).safeParse(req.body);
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

app.post('/api/orders', async (req, reply) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
  const user = userFromInit(parsed.data.initData);
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

app.post('/api/orders/nearby', async (req, reply) => {
  const parsed = nearbySchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });
  const user = userFromInit(parsed.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

  pruneExpired();
  const { latitude, longitude, radiusMeters } = parsed.data;
  const now = Date.now();

  const items = listOrders()
    .filter((o) => {
      if (o.status !== 'OPEN') return false;
      if (new Date(o.expiresAt).getTime() <= now) return false;
      if (o.creatorTelegramId === user.id) return false;
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return dist <= radiusMeters && dist <= o.radiusMeters;
    })
    .map((o) => {
      const dist = distanceMeters(latitude, longitude, o.latitude, o.longitude);
      return toPublicCard(o, dist);
    })
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, 50);

  return reply.send({ items });
});

app.post('/api/orders/take', async (req, reply) => {
  const parsed = takeSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'BAD_REQUEST' });
  const user = userFromInit(parsed.data.initData);
  if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

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
  const order = updated;

  await stripGpsFromService(updated);

  let creatorNotified = false;
  let takerNotified = false;
  try {
    await bot.api.sendMessage(
      order.creatorTelegramId,
      `Вашу заявку взяли!\n${order.description}\nИсполнитель: ${user.first_name}${user.username ? ` @${user.username}` : ''}`,
    );
    creatorNotified = true;
  } catch {
    /* */
  }
  try {
    await bot.api.sendMessage(
      user.id,
      `Вы взяли заявку!\n${order.description}\nЗаказчик: ${order.creatorName}${order.creatorUsername ? ` @${order.creatorUsername}` : ''}`,
    );
    takerNotified = true;
  } catch {
    /* */
  }

  return reply.send({
    id: updated.id,
    status: 'TAKEN',
    message: 'Заявка взята',
    notifications: { creatorNotified, takerNotified },
  });
});

const orderIdSchema = z.object({
  initData: z.string().min(1),
  orderId: z.string().uuid(),
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
    /* */
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
