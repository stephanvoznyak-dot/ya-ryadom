declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
        themeParams: Record<string, string>;
        colorScheme: 'light' | 'dark';
      };
    };
  }
}

export function getTelegram() {
  return window.Telegram?.WebApp;
}

export function getInitData(): string {
  return window.Telegram?.WebApp?.initData || '';
}

export function ready() {
  const tg = getTelegram();
  if (tg) {
    tg.ready();
    tg.expand();
  }
}
