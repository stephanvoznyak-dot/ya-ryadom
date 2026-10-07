/**
 * Патч для apps/bot/src/index.ts
 * Добавляет безопасную поддержку нативного Android-клиента (Telegram X).
 * См. полную версию в репозитории.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { validateInitData, type TgUser } from './telegram-auth.js';

const nativeUserFields = {
  nativeClient: z.literal(true).optional(),
  userId: z.number().int().positive().optional(),
  firstName: z.string().min(1).max(128).optional(),
  username: z.string().max(64).nullable().optional(),
  timestamp: z.number().int().positive().optional(),
  signature: z.string().min(64).max(128).optional(),
};

export function resolveUser(
  body: any,
  botToken: string,
  nativeSecret?: string
): TgUser | null {
  if (body.initData) {
    return validateInitData(body.initData, botToken);
  }

  if (
    body.nativeClient === true &&
    body.userId &&
    body.firstName &&
    body.timestamp &&
    body.signature &&
    nativeSecret
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - body.timestamp) > 300) return null;

    const payload = `${body.userId}:${body.firstName}:${body.timestamp}`;
    const expected = createHmac('sha256', nativeSecret).update(payload).digest('hex');

    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(body.signature, 'utf8');
      if (a.length !== b.length) return null;
      if (!timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }

    return {
      id: body.userId,
      first_name: body.firstName,
      username: body.username ?? undefined,
    };
  }

  return null;
}
