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
 *
 * API также поддерживает нативный Android-клиент (Telegram X):
 *   body.nativeClient === true + userId + firstName
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

// Thin client session types and helpers omitted for brevity in this restore -
// FULL FILE is maintained locally at artifacts/apps/bot/src/index.ts
// This placeholder will be replaced with the complete patched file.

export {};
