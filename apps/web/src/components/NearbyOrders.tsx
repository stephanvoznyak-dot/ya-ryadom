import { useCallback, useEffect, useState } from 'react';
import {
  nearby,
  takeOrder,
  myTaken,
  completeOrder,
  type NearbyItem,
  type MineItem,
} from '../lib/api';
import { getCurrentPosition, formatDistance } from '../lib/location';

const RADII = [
  { value: 1000, label: '1 км' },
  { value: 2000, label: '2 км' },
  { value: 5000, label: '5 км' },
  { value: 10000, label: '10 км' },
  { value: 20000, label: '20 км' },
] as const;

const LABELS: Record<string, string> = {
  RIDE: 'Поездка',
  DELIVERY: 'Доставка',
  REPAIR: 'Ремонт',
  CLEANING: 'Уборка',
  SHOPPING: 'Купить',
  COMPUTER: 'Компьютер',
  HELP: 'Помощь',
  RENTAL: 'Аренда',
  OTHER: 'Другое',
};

type Props = { initData: string; onBack: () => void };

export function NearbyOrders({ initData, onBack }: Props) {
  const [radius, setRadius] = useState(5000);
  const [items, setItems] = useState<NearbyItem[]>([]);
  const [mine, setMine] = useState<MineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
      const pos = await getCurrentPosition();
      const res = await nearby(
        initData,
        pos.coords.latitude,
        pos.coords.longitude,
        r,
      );
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
  }, [initData]);

  async function onTake(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      await takeOrder(initData, id);
      setMsg('Заявка взята');
      setItems((prev) => prev.filter((x) => x.id !== id));
      await loadMine();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось взять');
    } finally {
      setBusyId(null);
    }
  }

  async function onComplete(id: string) {
    setBusyId(id);
    try {
      await completeOrder(initData, id);
      setMine((prev) => prev.filter((x) => x.id !== id));
      setMsg('Заявка завершена');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Назад
      </button>
      <h1 className="title">Я могу</h1>
      <label className="label">
        Радиус поиска
        <select
          className="input"
          value={radius}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRadius(v);
            load(v);
          }}
        >
          {RADII.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {msg && <p className="subtitle">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="subtitle">Загрузка…</p>}
      {!loading && items.length === 0 && !error && (
        <p className="subtitle">Рядом открытых заявок нет.</p>
      )}
      {items.map((o) => (
        <div key={o.id} className="card">
          <p className="card-title">
            {LABELS[o.category] ?? o.category}
          </p>
          <p>{o.description}</p>
          {o.destinationText && <p className="card-meta">→ {o.destinationText}</p>}
          <p className="card-meta">
            {o.distanceMeters != null ? formatDistance(o.distanceMeters) : ''} · {o.creatorName}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId === o.id}
            onClick={() => onTake(o.id)}
          >
            {busyId === o.id ? '…' : 'Взять'}
          </button>
        </div>
      ))}
      {mine.length > 0 && (
        <>
          <h2 className="title" style={{ fontSize: '1.2rem', marginTop: 24 }}>
            Мои взятые
          </h2>
          {mine.map((o) => (
            <div key={o.id} className="card">
              <p className="card-title">{LABELS[o.category] ?? o.category}</p>
              <p>{o.description}</p>
              <p className="card-meta">Заказчик: {o.creatorName}</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyId === o.id}
                onClick={() => onComplete(o.id)}
              >
                Завершить
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
