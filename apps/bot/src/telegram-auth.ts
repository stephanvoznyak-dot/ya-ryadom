import { createHmac, timingSafeEqual } from 'node:crypto';

export type TgUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

/**
 * Validate Telegram WebApp initData.
 * - HMAC with bot token (WebAppData)
 * - auth_date TTL (default 1 hour; was 24h — tightened)
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
): TgUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(calculated, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) {
      return null;
    }

    const user = JSON.parse(params.get('user') || 'null') as TgUser;
    if (!user?.id || !user.first_name) return null;
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
    };
  } catch {
    return null;
  }
}

/**
 * Canonical native-client payload (no ambiguous `:` separators).
 * firstName may contain any characters.
 */
export function nativePayload(userId: number, firstName: string, timestamp: number): string {
  return `v1\nuserId=${userId}\ntimestamp=${timestamp}\nfirstName=${firstName}`;
}

export function signNative(
  secret: string,
  userId: number,
  firstName: string,
  timestamp: number,
): string {
  return createHmac('sha256', secret).update(nativePayload(userId, firstName, timestamp)).digest('hex');
}

/** Verify HMAC for native Android client. TTL ±300s. */
export function verifyNativeSignature(
  secret: string,
  userId: number,
  firstName: string,
  timestamp: number,
  signature: string,
  maxSkewSeconds = 300,
): boolean {
  if (!secret || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxSkewSeconds) return false;

  const expected = signNative(secret, userId, firstName, timestamp);
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
