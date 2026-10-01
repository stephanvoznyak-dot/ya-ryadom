import { useCallback, useEffect, useState } from 'react';
import {
  nearby,
  takeOrder,
  myTaken,
  completeOrder,
  type NearbyItem,
  type MineItem,
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
    try {
      const r = await takeOrder(initData, id);
      setMsg(
        r.notifications?.creatorNotified
          ? 'Заявка взята. Заказчик уведомлён.'
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
          <p>Рядом пока нет заявок.</p>
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
