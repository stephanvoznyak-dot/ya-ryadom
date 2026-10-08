/**
 * Source of truth for orders = this JSON store (single Node process).
 * Service Telegram chat = chronicle only, not a database.
 *
 * Invariants:
 * 1. One OPEN order → exactly one TAKE winner (tryTake is synchronous).
 * 2. GPS stays in store for matching; never returned in public API responses.
 * 3. After COMPLETE/CANCEL coordinates are scrubbed (privacy).
 * 4. Only one bot instance: horizontal scaling breaks tryTake.
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
    // Hard-fail: empty fallback would silently lose all open orders
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

/** Scrub GPS after order is no longer needed for matching */
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
 * Atomic TAKE for a single Node process:
 * load → check OPEN → write TAKEN → save without await inside.
 * Two parallel HTTP requests in one process will not both see OPEN.
 * Multiple instances / cluster — not supported.
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

/** Close order by taker: TAKEN → COMPLETED. Only taker; second complete → null. */
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

/** Active orders taken by user (not yet completed) */
export function listTakenBy(telegramUserId: number): Order[] {
  return load().filter(
    (o) => o.status === 'TAKEN' && o.takerTelegramId === telegramUserId,
  );
}
