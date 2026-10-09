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
  cancelledAt?: string;
  cancelReason?: string;
  cancelledByTelegramId?: number;
}

export type MetricEvent = {
  at: string;
  type:
    | 'order_created'
    | 'order_taken'
    | 'order_completed'
    | 'order_cancelled'
    | 'order_expired';
  orderId: string;
  category?: string;
  userId?: number;
  reason?: string;
};

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'orders.json');
const BACKUP_FILE = path.join(DATA_DIR, 'orders.json.bak');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

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
    console.error('FATAL: failed to parse orders.json — refusing empty fallback', e);
    throw e;
  }
}

function backupIfNeeded(orders: Order[]) {
  try {
    if (fs.existsSync(FILE)) {
      fs.copyFileSync(FILE, BACKUP_FILE);
    }
  } catch (e) {
    console.error('orders.json backup failed', e);
  }
  void orders.length;
}

function save(orders: Order[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backupIfNeeded(orders);
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

export function appendEvent(ev: Omit<MetricEvent, 'at'> & { at?: string }) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const line =
      JSON.stringify({
        at: ev.at ?? new Date().toISOString(),
        type: ev.type,
        orderId: ev.orderId,
        category: ev.category,
        userId: ev.userId,
        reason: ev.reason,
      }) + '\n';
    fs.appendFileSync(EVENTS_FILE, line, 'utf8');
  } catch (e) {
    console.error('appendEvent failed', e);
  }
}

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
  appendEvent({
    type: 'order_created',
    orderId: order.id,
    category: order.category,
    userId: order.creatorTelegramId,
  });
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
    orders[i] = scrubCoords({
      ...o,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      cancelReason: 'expired',
    });
    save(orders);
    appendEvent({ type: 'order_expired', orderId: o.id, category: o.category });
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
  appendEvent({
    type: 'order_taken',
    orderId: o.id,
    category: o.category,
    userId: taker.telegramId,
  });
  return orders[i];
}

export function pruneExpired() {
  const now = Date.now();
  let changed = false;
  const orders = load().map((o) => {
    if (o.status === 'OPEN' && new Date(o.expiresAt).getTime() <= now) {
      changed = true;
      appendEvent({ type: 'order_expired', orderId: o.id, category: o.category });
      return scrubCoords({
        ...o,
        status: 'CANCELLED' as const,
        cancelledAt: new Date().toISOString(),
        cancelReason: 'expired',
      });
    }
    return o;
  });
  if (changed) save(orders);
}

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
  appendEvent({
    type: 'order_completed',
    orderId: o.id,
    category: o.category,
    userId: telegramUserId,
  });
  return orders[i];
}

export function tryCancel(
  orderId: string,
  telegramUserId: number,
  reason: string,
): Order | null {
  const orders = load();
  const i = orders.findIndex((o) => o.id === orderId);
  if (i < 0) return null;
  const o = orders[i];
  if (o.status === 'OPEN') {
    if (o.creatorTelegramId !== telegramUserId) return null;
  } else if (o.status === 'TAKEN') {
    if (
      o.creatorTelegramId !== telegramUserId &&
      o.takerTelegramId !== telegramUserId
    ) {
      return null;
    }
  } else {
    return null;
  }
  const safeReason = reason.trim().slice(0, 200) || 'unspecified';
  orders[i] = scrubCoords({
    ...o,
    status: 'CANCELLED',
    cancelledAt: new Date().toISOString(),
    cancelReason: safeReason,
    cancelledByTelegramId: telegramUserId,
  });
  save(orders);
  appendEvent({
    type: 'order_cancelled',
    orderId: o.id,
    category: o.category,
    userId: telegramUserId,
    reason: safeReason,
  });
  return orders[i];
}

export function listTakenBy(telegramUserId: number): Order[] {
  return load().filter(
    (o) => o.status === 'TAKEN' && o.takerTelegramId === telegramUserId,
  );
}

export function listCreatedActive(telegramUserId: number): Order[] {
  return load().filter(
    (o) =>
      o.creatorTelegramId === telegramUserId &&
      (o.status === 'OPEN' || o.status === 'TAKEN'),
  );
}
