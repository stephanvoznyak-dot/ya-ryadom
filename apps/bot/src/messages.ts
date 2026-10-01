import type { Order } from './store.js';

const CAT: Record<string, string> = {
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

/** Full message for service chat (includes GPS — operators only) */
export function formatServiceMessage(order: Order, withGps: boolean): string {
  const lines = [
    `📋 ${CAT[order.category] ?? order.category}`,
    order.description,
  ];
  if (order.destinationText) lines.push(`→ ${order.destinationText}`);
  if (withGps) {
    lines.push(`📍 ${order.latitude.toFixed(5)}, ${order.longitude.toFixed(5)}`);
    lines.push(`Радиус: ${order.radiusMeters / 1000} км`);
  }
  lines.push(`От: ${order.creatorName}${order.creatorUsername ? ` @${order.creatorUsername}` : ''}`);
  lines.push(`id:${order.id}`);
  if (order.status === 'TAKEN' || order.status === 'COMPLETED') {
    lines.push(`✅ Взял: ${order.takerName ?? ''}${order.takerUsername ? ` @${order.takerUsername}` : ''}`);
  }
  if (order.status === 'COMPLETED') lines.push('✔️ Выполнена');
  if (order.status === 'CANCELLED') lines.push('⛔ Отменена / истекла');
  return lines.join('\n');
}

/** Public card for Mini App — never exposes exact coords of others */
export function toPublicCard(
  order: Order,
  distanceMeters?: number,
): {
  id: string;
  category: string;
  description: string;
  destinationText?: string;
  distanceMeters?: number;
  status: string;
  creatorName: string;
} {
  return {
    id: order.id,
    category: order.category,
    description: order.description,
    destinationText: order.destinationText,
    distanceMeters,
    status: order.status,
    creatorName: order.creatorName,
  };
}
