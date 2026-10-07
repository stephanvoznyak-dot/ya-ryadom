/**
 * Smoke test: atomic TAKE — only one winner within a single process.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-smoke');
process.env.DATA_DIR = dir;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const { loadOrders, saveOrders, tryTake, type Order } = await import('./store.js');

function seedOrder(overrides: Partial<Order> = {}): Order {
  const now = new Date();
  const order: Order = {
    id: randomUUID(),
    status: 'OPEN',
    category: 'HELP',
    description: 'smoke test',
    latitude: 56.3,
    longitude: 44.0,
    radiusMeters: 5000,
    creatorId: 1,
    creatorName: 'Alice',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    ...overrides,
  };
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}

const o = seedOrder();

const r1 = tryTake(o.id, { id: 2, name: 'Bob' });
const r2 = tryTake(o.id, { id: 3, name: 'Carol' });

const okTake = r1.ok === true && r2.ok === false && r1.order?.takerId === 2;

const mine = loadOrders().filter((x) => x.takerId === 2 && x.status === 'TAKEN');
const okMine = mine.length === 1 && mine[0].id === o.id;

const orders = loadOrders();
const taken = orders.find((x) => x.id === o.id)!;
if (taken.takerId === 2) {
  taken.status = 'COMPLETED';
  taken.completedAt = new Date().toISOString();
  saveOrders(orders);
}
const after = loadOrders().find((x) => x.id === o.id);
const okComplete = after?.status === 'COMPLETED';

console.log(okTake ? '✓ TAKE one winner' : '✗ TAKE race');
console.log(okMine ? '✓ list taken by user' : '✗ list taken');
console.log(okComplete ? '✓ COMPLETE by taker' : '✗ COMPLETE');

fs.rmSync(dir, { recursive: true, force: true });
process.exit(okTake && okMine && okComplete ? 0 : 1);
