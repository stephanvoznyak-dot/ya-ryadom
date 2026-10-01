import crypto from 'node:crypto';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function validateInitData(initData: string, botToken: string, maxAge = 86400): TgUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculated !== hash) return null;
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > maxAge) return null;
    const user = JSON.parse(params.get('user') || 'null') as TgUser;
    if (!user?.id || !user.first_name) return null;
    return user;
  } catch {
    return null;
  }
}
