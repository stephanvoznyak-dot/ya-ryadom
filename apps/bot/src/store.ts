/**
 * Источник истины по заявкам = этот JSON-store (один процесс Node).
 * Служебный Telegram-чат = только хроника/публикация, не БД.
 *
 * Инварианты:
 * 1. Одна OPEN-заявка → ровно один победитель TAKE (tryTake синхронный).
 * 2. GPS в store для матчинга; в ответы Mini App не попадает (toPublicCard).
 * 3. После COMPLETE/CANCEL координаты обнуляются (privacy).
 * 4. Только один инстанс бота: горизонтальное масштабирование ломает tryTake.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type OrderStatus = 'OPEN' | 'TAKEN' | 'COMPLETED' | 'CANCELLED';

export interface Order {
  id: string;
  status: OrderStatus;
  category: string;
  description: string;
  destinationText?: string;
  /** Internal only — never in public API responses */
  latitude: number;
  longitude: number;
  radiusMeters: number;
  creatorTelegramId: number;
  creatorName: string;
  creatorUsername: string | null;
  serviceMessageId?: number;
  serviceChatId?: number;
  takerTelegramId?: number;
  takerName?: string;
  takerUsername?: string | null;
  createdAt: string;
  expiresAt: string;
  takenAt?: string;
  completedAt?: string;
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

function load(): Order[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, 'utf8');
    if (!raw.trim()) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('orders.json is not an array');
    }
    return data as Order[];
  } catch (e) {
    // Hard-fail: empty state would silently lose all open orders
    console.error('FATAL: failed to parse orders.json — refusing empty fallback', e);
    throw e;
  }
}

function save(orders: Order[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(orders, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);
}

/** Scrub GPS after order is no longer OPEN/TAKEN for matching */
function scrubCoords(o: Order): Order {
  if (o.status === 'COMPLETED' || o.status === 'CANCELLED') {
    return { ...o, latitude: 0, longitude: 0 };
  }
  return o;
}

export function listOrders(): Order[] {
  return load();
}

export function getOrder(id: string): Order | undefined {
  return load().find((o) => o.id === id);
}

export function addOrder(input: {
  category: string;
  description: string;
  destinationText?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  creatorTelegramId: number;
  creatorName: string;
  creatorUsername: string | null;
  expiresInMinutes: number;
}): Order {
  const orders = load();
  const now = Date.now();
  const order: Order = {
    id: randomUUID(),
    status: 'OPEN',
    category: input.category,
    description: input.description,
    destinationText: input.destinationText,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters,
    creatorTelegramId: input.creatorTelegramId,
    creatorName: input.creatorName,
    creatorUsername: input.creatorUsername,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.expiresInMinutes * 60_000).toISOString(),
  };
  orders.push(order);
  save(orders);
  return order;
}

export function updateOrder(id: string, patch: Partial<Order>): Order | null {
  const orders = load();
  const i = orders.findIndex((o) => o.id === id);
  if (i < 0) return null;
  orders[i] = scrubCoords({ ...orders[i], ...patch });
  save(orders);
  return orders[i];
}

/**
 * Атомарный TAKE для одного Node-процесса:
 * load → check OPEN → write TAKEN → save без await внутри.
 * Два параллельных HTTP-запроса в одном процессе не разделят «OPEN».
 * Несколько инстансов / кластер — не поддерживаются.
 */
export function tryTake(
  orderId: string,
  taker: { telegramId: number; name: string; username: string | null },
): Order | null {
  const orders = load();
  const i = orders.findIndex((o) => o.id === orderId);
  if (i < 0) return null;

  const o = orders[i];
  if (o.status !== 'OPEN') return null;
  if (new Date(o.expiresAt).getTime() <= Date.now()) {
    orders[i] = scrubCoords({ ...o, status: 'CANCELLED' });
    save(orders);
    return null;
  }
  if (o.creatorTelegramId === taker.telegramId) return null;

  orders[i] = {
    ...o,
    status: 'TAKEN',
    takerTelegramId: taker.telegramId,
    takerName: taker.name,
    takerUsername: taker.username,
    takenAt: new Date().toISOString(),
  };
  save(orders);
  return orders[i];
}

export function pruneExpired() {
  const now = Date.now();
  let changed = false;
  const orders = load().map((o) => {
    if (o.status === 'OPEN' && new Date(o.expiresAt).getTime() <= now) {
      changed = true;
      return scrubCoords({ ...o, status: 'CANCELLED' as const });
    }
    return o;
  });
  if (changed) save(orders);
}

/**
 * Закрытие заявки исполнителем: TAKEN → COMPLETED.
 * Только taker; повторный complete → null. GPS scrubbed.
 */
export function tryComplete(orderId: string, telegramUserId: number): Order | null {
  const orders = load();
  const i = orders.findIndex((o) => o.id === orderId);
  if (i < 0) return null;
  const o = orders[i];
  if (o.status !== 'TAKEN') return null;
  if (o.takerTelegramId !== telegramUserId) return null;

  orders[i] = scrubCoords({
    ...o,
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
  });
  save(orders);
  return orders[i];
}

/** Активные заявки, взятые пользователем (ещё не завершённые) */
export function listTakenBy(telegramUserId: number): Order[] {
  return load().filter(
    (o) => o.status === 'TAKEN' && o.takerTelegramId === telegramUserId,
  );
}
