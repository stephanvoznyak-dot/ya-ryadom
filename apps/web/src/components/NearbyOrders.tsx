import { useCallback, useEffect, useState } from 'react';
import {
  nearby,
  takeOrder,
  myTaken,
  completeOrder,
  cancelOrder,
  type NearbyItem,
  type MineItem,
  type Contact,
} from '../lib/api';
import { getUserLocation } from '../lib/location';

const RADII = [1000, 2000, 5000, 10000, 20000] as const;
const LABELS: Record<string, string> = {
  RIDE: 'Поездка',
  DELIVERY: 'Доставка',
  REPAIR: 'Ремонт',
  CLEANING: 'Уборка',
  SHOPPING: 'Купить',
  COMPUTER: 'Компьютер',
  HELP: 'Помощь',
  OTHER: 'Другое',
};

function dist(m?: number) {
  if (m == null) return '';
  return m < 1000 ? `${m} м` : `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

export function NearbyOrders({
  initData,
  onBack,
}: {
  initData: string;
  onBack: () => void;
}) {
  const [radius, setRadius] = useState(5000);
  const [items, setItems] = useState<NearbyItem[]>([]);
  const [mine, setMine] = useState<MineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [suggestedRadius, setSuggestedRadius] = useState<number | null>(null);
  const [lastContact, setLastContact] = useState<Contact | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const loadMine = useCallback(async () => {
    try {
      const r = await myTaken(initData);
      setMine(r.items);
    } catch {
      /* ignore */
    }
  }, [initData]);

  async function load(r = radius) {
    setLoading(true);
    setError(null);
    try {
      let lat = coords?.lat;
      let lng = coords?.lng;
      if (lat == null || lng == null) {
        const loc = await getUserLocation();
        lat = loc.latitude;
        lng = loc.longitude;
        setCoords({ lat, lng });
      }
      const res = await nearby(initData, lat, lng, r);
      setItems(res.items);
      setEmptyHint(res.hint ?? null);
      setSuggestedRadius(res.suggestedRadiusMeters ?? null);
      await loadMine();
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  async function take(id: string) {
    if (busyId) return;
    setBusyId(id);
    setMsg(null);
    setLastContact(null);
    try {
      const r = await takeOrder(initData, id);
      setLastContact(r.contact ?? null);
      setMsg(
        r.contact?.telegramLink
          ? 'Заявка взята. Напишите заказчику в Telegram.'
          : r.notifications?.creatorNotified
            ? 'Заявка взята. Заказчик уведомлён в боте.'
            : 'Заявка взята.',
      );
      setItems((prev) => prev.filter((x) => x.id !== id));
      await loadMine();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Уже недоступна');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function complete(id: string) {
    if (busyId) return;
    setBusyId(id);
    setMsg(null);
    try {
      await completeOrder(initData, id);
      setMsg('Заявка выполнена.');
      setMine((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось завершить');
      await loadMine();
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    if (busyId) return;
    setBusyId(id);
    setMsg(null);
    try {
      await cancelOrder(initData, id, 'cancelled_via_miniapp');
      setMsg('Заявка отменена.');
      setMine((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось отменить');
      await loadMine();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen">
      <h1 className="title">Я могу</h1>
      <p className="subtitle">Заявки рядом (по вашей геолокации)</p>

      {mine.length > 0 && (
        <div className="order-list" style={{ marginBottom: 16 }}>
          <p className="card-category">В работе</p>
          {mine.map((o) => (
            <div key={o.id} className="order-card">
              <p className="card-category">{LABELS[o.category] ?? o.category}</p>
              <p className="card-desc">{o.description}</p>
              <p className="hint">
                Заказчик: {o.creatorName}
                {o.creatorUsername ? ` @${o.creatorUsername}` : ''}
              </p>
              {o.contact?.telegramLink && (
                <p className="hint">
                  <a href={o.contact.telegramLink} target="_blank" rel="noreferrer">
                    Написать в Telegram
                  </a>
                </p>
              )}
              <div className="order-card-footer">
                <span className="distance">взята вами</span>
                <button
                  type="button"
                  className="btn btn-primary btn-take"
                  disabled={!!busyId}
                  onClick={() => complete(o.id)}
                >
                  {busyId === o.id ? '…' : 'Завершить'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!!busyId}
                  onClick={() => cancel(o.id)}
                >
                  Отменить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="radius-row">
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            className={`chip ${radius === r ? 'chip-active' : ''}`}
            onClick={() => setRadius(r)}
          >
            {r / 1000} км
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading}>
        {loading ? '…' : 'Обновить'}
      </button>

      {msg && <p className="hint">{msg}</p>}
      {lastContact?.telegramLink && (
        <p className="hint">
          <a href={lastContact.telegramLink} target="_blank" rel="noreferrer">
            {lastContact.hint}
          </a>
        </p>
      )}
      {error && (
        <div className="error-block">
          <p className="error">{error}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => load()}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          <p>{emptyHint ?? 'Рядом пока нет заявок.'}</p>
          {suggestedRadius != null && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setRadius(suggestedRadius)}
            >
              Расширить до {suggestedRadius / 1000} км
            </button>
          )}
        </div>
      )}

      <div className="order-list">
        {items.map((o) => (
          <div key={o.id} className="order-card">
            <p className="card-category">{LABELS[o.category] ?? o.category}</p>
            <p className="card-desc">{o.description}</p>
            {o.destinationText && <p className="hint">→ {o.destinationText}</p>}
            <div className="order-card-footer">
              <span className="distance">{dist(o.distanceMeters)}</span>
              <button
                type="button"
                className="btn btn-primary btn-take"
                disabled={!!busyId}
                onClick={() => take(o.id)}
              >
                {busyId === o.id ? '…' : 'Взять'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-secondary" onClick={onBack}>
        Назад
      </button>
    </div>
  );
}
