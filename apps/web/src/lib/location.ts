/**
 * Abstract geolocation for Telegram Mini App.
 * Tries browser Geolocation API (available in many Telegram WebViews).
 */
export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export function getUserLocation(timeoutMs = 15000): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация недоступна в этом клиенте'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        const messages: Record<number, string> = {
          1: 'Доступ к геолокации запрещён',
          2: 'Не удалось определить местоположение',
          3: 'Таймаут определения местоположения',
        };
        reject(new Error(messages[err.code] ?? 'Ошибка геолокации'));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60_000,
      },
    );
  });
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}
