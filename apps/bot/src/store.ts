import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const ORDERS_PATH = join(DATA_DIR, 'orders.json');

export type OrderStatus = 'OPEN' | 'TAKEN' | 'COMPLETED' | 'CANCELLED';

export type Order = {
  id: string;
  status: OrderStatus;
  category: string;
  description: string;
  latitude: number;
  longitude: number;
  destinationText?: string;
  radiusMeters: number;
  creatorId: number;
  creatorName: string;
  creatorUsername?: string;
  takerId?: number;
  takerName?: string;
  takerUsername?: string;
  serviceChatId?: number;
  serviceMessageId?: number;
  createdAt: string;
  expiresAt: string;
  takenAt?: string;
  completedAt?: string;
};

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadOrders(): Order[] {
  ensureDataDir();
  if (!existsSync(ORDERS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(ORDERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

export function saveOrders(orders: Order[]) {
  ensureDataDir();
  const tmp = ORDERS_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(orders, null, 2), 'utf8');
  renameSync(tmp, ORDERS_PATH);
}

/** Atomic take: load → check → save without await */
export function tryTake(
  orderId: string,
  taker: { id: number; name: string; username?: string }
): { ok: boolean; reason?: string; order?: Order } {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: 'NOT_FOUND' };
  if (order.status !== 'OPEN') return { ok: false, reason: 'ALREADY_TAKEN' };
  if (new Date(order.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
  if (order.creatorId === taker.id) return { ok: false, reason: 'OWN_ORDER' };

  order.status = 'TAKEN';
  order.takerId = taker.id;
  order.takerName = taker.name;
  order.takerUsername = taker.username;
  order.takenAt = new Date().toISOString();
  saveOrders(orders);
  return { ok: true, order };
}
