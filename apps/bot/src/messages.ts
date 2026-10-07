import type { Order } from './store.js';

export function formatNewOrder(o: Order): string {
  return (
    `<b>Новая заявка</b>\n` +
    `📂 ${o.category}\n` +
    `${o.description}\n` +
    (o.destinationText ? `📍 ${o.destinationText}\n` : '') +
    `👤 ${o.creatorName}${o.creatorUsername ? ' @' + o.creatorUsername : ''}\n` +
    `🗺 ${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}\n` +
    `⏱ до ${new Date(o.expiresAt).toLocaleString('ru')}`
  );
}

export function formatTakenOrder(o: Order): string {
  return (
    `<b>Взята</b>\n` +
    `📂 ${o.category}\n` +
    `${o.description}\n` +
    (o.destinationText ? `→ ${o.destinationText}\n` : '') +
    `👤 ${o.creatorName} → ${o.takerName}${o.takerUsername ? ' @' + o.takerUsername : ''}`
  );
}
