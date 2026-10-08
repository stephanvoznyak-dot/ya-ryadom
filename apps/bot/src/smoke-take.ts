/**
 * Smoke test: atomic TAKE, COMPLETE only by taker, CANCEL permissions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-smoke');
process.env.DATA_DIR = dir;
fs.rmSync(dir, { recursive: true, force: true });

const {
  addOrder,
  tryTake,
  tryComplete,
  tryCancel,
  listTakenBy,
} = await import('./store.js');

const o = addOrder({
  category: 'HELP',
  description: 'smoke',
  latitude: 56.3,
  longitude: 44.0,
  radiusMeters: 5000,
  creatorTelegramId: 1,
  creatorName: 'A',
  creatorUsername: null,
  expiresInMinutes: 30,
});

const r1 = tryTake(o.id, { telegramId: 2, name: 'B', username: 'buser' });
const r2 = tryTake(o.id, { telegramId: 3, name: 'C', username: null });
const okTake = r1 !== null && r2 === null && r1!.takerTelegramId === 2;

const mine = listTakenBy(2);
const okMine = mine.length === 1 && mine[0].id === o.id;

const cWrong = tryComplete(o.id, 3);
const cOk = tryComplete(o.id, 2);
const cTwice = tryComplete(o.id, 2);
const okComplete = cWrong === null && cOk?.status === 'COMPLETED' && cTwice === null;

const o2 = addOrder({
  category: 'SHOPPING',
  description: 'cancel-smoke',
  latitude: 56.3,
  longitude: 44.0,
  radiusMeters: 2000,
  creatorTelegramId: 10,
  creatorName: 'X',
  creatorUsername: 'xuser',
  expiresInMinutes: 30,
});
const cancelStranger = tryCancel(o2.id, 99, 'nope');
const cancelCreator = tryCancel(o2.id, 10, 'changed_plans');
const okCancelOpen =
  cancelStranger === null &&
  cancelCreator?.status === 'CANCELLED' &&
  cancelCreator.cancelReason === 'changed_plans';

const o3 = addOrder({
  category: 'DELIVERY',
  description: 'cancel-taken',
  latitude: 56.3,
  longitude: 44.0,
  radiusMeters: 2000,
  creatorTelegramId: 20,
  creatorName: 'Y',
  creatorUsername: null,
  expiresInMinutes: 30,
});
tryTake(o3.id, { telegramId: 21, name: 'Z', username: null });
const cancelTaker = tryCancel(o3.id, 21, 'cannot_do');
const okCancelTaken = cancelTaker?.status === 'CANCELLED';

const eventsPath = path.join(dir, 'events.jsonl');
const bakPath = path.join(dir, 'orders.json.bak');
const okEvents = fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, 'utf8').includes('order_created');
const okBackup = fs.existsSync(bakPath);

console.log(okTake ? '✓ TAKE one winner' : '✗ TAKE race');
console.log(okMine ? '✓ listTakenBy' : '✗ listTakenBy');
console.log(okComplete ? '✓ COMPLETE only taker, once' : '✗ COMPLETE');
console.log(okCancelOpen ? '✓ CANCEL open by creator only' : '✗ CANCEL open');
console.log(okCancelTaken ? '✓ CANCEL taken by taker' : '✗ CANCEL taken');
console.log(okEvents ? '✓ events.jsonl' : '✗ events.jsonl');
console.log(okBackup ? '✓ orders.json.bak' : '✗ orders.json.bak');

fs.rmSync(dir, { recursive: true, force: true });
const ok =
  okTake && okMine && okComplete && okCancelOpen && okCancelTaken && okEvents && okBackup;
process.exit(ok ? 0 : 1);
