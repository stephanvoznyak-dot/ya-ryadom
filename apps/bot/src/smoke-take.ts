/**
 * Smoke test: atomic TAKE (one winner) + COMPLETE only by taker.
 * Uses isolated DATA_DIR so it never touches real orders.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-smoke');
process.env.DATA_DIR = dir;
fs.rmSync(dir, { recursive: true, force: true });

const { addOrder, tryTake, tryComplete, listTakenBy } = await import('./store.js');

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

const r1 = tryTake(o.id, { telegramId: 2, name: 'B', username: null });
const r2 = tryTake(o.id, { telegramId: 3, name: 'C', username: null });
const okTake = r1 !== null && r2 === null && r1!.takerTelegramId === 2;

const mine = listTakenBy(2);
const okMine = mine.length === 1 && mine[0].id === o.id;

const cWrong = tryComplete(o.id, 3); // not taker
const cOk = tryComplete(o.id, 2);
const cTwice = tryComplete(o.id, 2);
const okComplete = cWrong === null && cOk?.status === 'COMPLETED' && cTwice === null;

console.log(okTake ? '✓ TAKE one winner' : '✗ TAKE race');
console.log(okMine ? '✓ listTakenBy' : '✗ listTakenBy');
console.log(okComplete ? '✓ COMPLETE only taker, once' : '✗ COMPLETE');

fs.rmSync(dir, { recursive: true, force: true });
process.exit(okTake && okMine && okComplete ? 0 : 1);
