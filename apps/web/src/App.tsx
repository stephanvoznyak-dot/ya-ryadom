import { useEffect, useState } from 'react';
import { initTelegram, getTelegramWebApp } from './lib/telegram';
import { auth, type User } from './lib/api';
import { CreateOrderForm } from './components/CreateOrderForm';
import { NearbyOrders } from './components/NearbyOrders';

type Screen = 'home' | 'need' | 'can';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [user, setUser] = useState<User | null>(null);
  const [initData, setInitData] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tg = initTelegram();
    if (tg?.themeParams) {
      const root = document.documentElement;
      const map: Record<string, string> = {
        bg_color: '--tg-theme-bg-color',
        text_color: '--tg-theme-text-color',
        hint_color: '--tg-theme-hint-color',
        link_color: '--tg-theme-link-color',
        button_color: '--tg-theme-button-color',
        button_text_color: '--tg-theme-button-text-color',
        secondary_bg_color: '--tg-theme-secondary-bg-color',
      };
      for (const [k, v] of Object.entries(map)) {
        if (tg.themeParams[k]) root.style.setProperty(v, tg.themeParams[k]);
      }
    }

    const data = getTelegramWebApp()?.initData ?? '';
    setInitData(data);

    if (!data) {
      setError('Откройте приложение через Telegram-бота.');
      setLoading(false);
      return;
    }

    auth(data)
      .then((r) => setUser(r.user))
      .catch(() => setError('Не удалось войти. Откройте приложение снова.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="screen">
        <p className="subtitle">Загрузка…</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="screen">
        <h1 className="title">Я рядом</h1>
        <p className="subtitle">{error ?? 'Ошибка'}</p>
      </div>
    );
  }

  if (screen === 'need') {
    return (
      <CreateOrderForm
        initData={initData}
        onBack={() => setScreen('home')}
        onCreated={() => setScreen('home')}
      />
    );
  }

  if (screen === 'can') {
    return <NearbyOrders initData={initData} onBack={() => setScreen('home')} />;
  }

  return (
    <div className="screen">
      <h1 className="title">Я рядом</h1>
      <p className="subtitle">Привет, {user.firstName}! Заявки рядом — только в приложении.</p>
      <div className="stack">
        <button type="button" className="btn btn-primary" onClick={() => setScreen('need')}>
          Мне нужно
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setScreen('can')}>
          Я могу
        </button>
      </div>
    </div>
  );
}
