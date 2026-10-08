const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const j = await res.json();
      code = j?.error;
      message = j?.message ?? j?.error ?? message;
    } catch {
      /* */
    }
    throw new ApiError(res.status, message, code);
  }
  return res.json() as Promise<T>;
}

export type User = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

export type Contact = {
  name: string;
  username: string | null;
  telegramLink: string | null;
  hint: string;
};

export function auth(initData: string) {
  return request<{ user: User }>('/api/auth', { initData });
}

export function createOrder(
  initData: string,
  payload: {
    category: string;
    description: string;
    latitude: number;
    longitude: number;
    destinationText?: string;
    radiusMeters: number;
    expiresInMinutes: number;
  },
) {
  return request<{ id: string; status: string; expiresAt: string }>('/api/orders', {
    initData,
    ...payload,
  });
}

export type NearbyItem = {
  id: string;
  category: string;
  description: string;
  destinationText?: string;
  distanceMeters?: number;
  status: string;
  creatorName: string;
};

export function nearby(
  initData: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  return request<{
    items: NearbyItem[];
    empty?: boolean;
    hint?: string;
    suggestedRadiusMeters?: number | null;
  }>('/api/orders/nearby', {
    initData,
    latitude,
    longitude,
    radiusMeters,
  });
}

export function takeOrder(initData: string, orderId: string) {
  return request<{
    id: string;
    status: string;
    message: string;
    notifications?: { creatorNotified: boolean; takerNotified: boolean };
    contact?: Contact;
  }>('/api/orders/take', { initData, orderId });
}

export type MineItem = {
  id: string;
  category: string;
  description: string;
  destinationText?: string;
  status: string;
  creatorName: string;
  creatorUsername: string | null;
  contact?: Contact;
};

export function myTaken(initData: string) {
  return request<{ items: MineItem[] }>('/api/orders/mine', { initData });
}

export function completeOrder(initData: string, orderId: string) {
  return request<{ id: string; status: string; message: string }>('/api/orders/complete', {
    initData,
    orderId,
  });
}

export function cancelOrder(initData: string, orderId: string, reason: string) {
  return request<{ id: string; status: string; message: string; reason?: string }>(
    '/api/orders/cancel',
    { initData, orderId, reason },
  );
}
