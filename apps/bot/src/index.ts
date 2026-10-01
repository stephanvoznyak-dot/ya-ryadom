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
const SERVICE_CHAT_ID = process.env.SERVICE_CHAT_ID;
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

// NOTE: full thin-client handlers and Mini API routes are in the complete source.
// This file is the primary entry; clone or sync remaining handlers from project artifacts if needed.

bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) setSession(userId, { step: 'idle' });
  await ctx.reply(
    'Я рядом\n\nЗаявки рядом с вами. Можно работать прямо в боте или открыть Mini App.',
    { reply_markup: mainKeyboard() },
  );
});

bot.catch((err) => console.error('Bot error', err));

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });
app.get('/health', async () => ({ status: 'ok' }));

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
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
