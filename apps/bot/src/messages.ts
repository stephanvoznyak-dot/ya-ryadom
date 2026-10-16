import type { Order } from './store.js';

const CAT: Record<string, string> = {
  RIDE: 'Поездка',
  DELIVERY: 'Доставка',
  REPAIR: 'Ремонт',
  CLEANING: 'Уборка',
  SHOPPING: 'Купить / принести',
  COMPUTER: 'Компьютер',
  HELP: 'Помощь',
  RENTAL: 'Прокат',
  OTHER: 'Другое',
};

export function bucketDistanceMeters(dist: number): number {
  if (dist < 100) return 50;
  if (dist < 250) return 200;
  if (dist < 500) return 400;
  if (dist < 1000) return 750;
  return Math.round(dist / 1000) * 1000;
}

/** Public label. Exact meters never leave the matcher. */
export function distanceBucketLabel(dist: number): string {
  if (dist < 300) return 'рядом';
  if (dist < 1000) return 'до 1 км';
  if (dist < 2000) return 'до 2 км';
  if (dist < 5000) return 'до 5 км';
  if (dist < 10000) return 'до 10 км';
  return 'до 20 км';
}

export function formatServiceMessage(order: Order, withGps: boolean): string {
  const lines = [
    `📋 ${CAT[order.category] ?? order.category}`,
    order.description,
  ];
  if (order.destinationText) lines.push(`→ ${order.destinationText}`);
  if (withGps && (order.latitude !== 0 || order.longitude !== 0)) {
    lines.push(`📍 ${order.latitude.toFixed(5)}, ${order.longitude.toFixed(5)}`);
    lines.push(`Радиус: ${order.radiusMeters / 1000} км`);
  }
  lines.push(`От: ${order.creatorName}${order.creatorUsername ? ` @${order.creatorUsername}` : ''}`);
  lines.push(`id:${order.id}`);
  if (order.status === 'TAKEN' || order.status === 'COMPLETED') {
    lines.push(
      `✅ Взял: ${order.takerName ?? ''}${order.takerUsername ? ` @${order.takerUsername}` : ''}`,
    );
  }
  if (order.status === 'COMPLETED') lines.push('✔️ Выполнена');
  if (order.status === 'CANCELLED') {
    lines.push(
      `⛔ Отменена${order.cancelReason ? `: ${order.cancelReason}` : ' / истекла'}`,
    );
  }
  return lines.join('\n');
}

export function toPublicCard(
  order: Order,
  distanceMeters?: number,
): {
  id: string;
  category: string;
  description: string;
  destinationText?: string;
  distanceBucket?: string;
  status: string;
  creatorName: string;
} {
  return {
    id: order.id,
    category: order.category,
    description: order.description,
    destinationText: order.destinationText,
    distanceBucket:
      distanceMeters === undefined ? undefined : distanceBucketLabel(distanceMeters),
    status: order.status,
    creatorName: order.creatorName,
  };
}

export function contactCard(order: Order, perspective: 'creator' | 'taker') {
  if (perspective === 'taker') {
    return {
      name: order.creatorName,
      username: order.creatorUsername,
      telegramLink: order.creatorUsername
        ? `https://t.me/${order.creatorUsername}`
        : null,
      hint: order.creatorUsername
        ? 'Напишите заказчику в Telegram'
        : 'У заказчика нет username — дождитесь сообщения в боте',
    };
  }
  return {
    name: order.takerName ?? '',
    username: order.takerUsername ?? null,
    telegramLink: order.takerUsername ? `https://t.me/${order.takerUsername}` : null,
    hint: order.takerUsername
      ? 'Напишите исполнителю в Telegram'
      : 'У исполнителя нет username — свяжитесь через бота',
  };
}
