import { useState, type FormEvent } from 'react';
import { createOrder } from '../lib/api';
import { getUserLocation } from '../lib/location';

const CATEGORIES = [
  { value: 'DELIVERY', label: 'Доставка' },
  { value: 'RIDE', label: 'Поездка' },
  { value: 'HELP', label: 'Помощь' },
  { value: 'SHOPPING', label: 'Купить / принести' },
  { value: 'REPAIR', label: 'Ремонт' },
  { value: 'CLEANING', label: 'Уборка' },
  { value: 'COMPUTER', label: 'Компьютер' },
  { value: 'OTHER', label: 'Другое' },
] as const;

const RADII = [
  { value: 1000, label: '1 км' },
  { value: 2000, label: '2 км' },
  { value: 5000, label: '5 км' },
  { value: 10000, label: '10 км' },
  { value: 20000, label: '20 км' },
] as const;

export function CreateOrderForm({
  initData,
  onBack,
  onCreated,
}: {
  initData: string;
  onBack: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState('DELIVERY');
  const [description, setDescription] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(5000);
  const [expiresInMinutes, setExpiresInMinutes] = useState(30);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function locate() {
    setLocLoading(true);
    setError(null);
    try {
      const loc = await getUserLocation();
      setLat(loc.latitude);
      setLng(loc.longitude);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нет геолокации');
    } finally {
      setLocLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lat == null || lng == null) {
      setError('Нужна геолокация');
      return;
    }
    if (description.trim().length < 3) {
      setError('Опишите, что нужно');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createOrder(initData, {
        category,
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        destinationText: destinationText.trim() || undefined,
        radiusMeters,
        expiresInMinutes,
      });
      setOk(true);
      setTimeout(onCreated, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать');
    } finally {
      setSubmitting(false);
    }
  }

  if (ok) {
    return (
      <div className="screen">
        <h1 className="title">Заявка создана</h1>
        <p className="subtitle">Её увидят люди рядом в приложении.</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title">Мне нужно</h1>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Категория</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            className="input textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Куда (необязательно)</span>
          <input
            className="input"
            value={destinationText}
            onChange={(e) => setDestinationText(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field-label">Где вы</span>
          <p className="field-help">
            Координаты нужны только для подбора рядом. В списке у других точный адрес не показывается.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={locate} disabled={locLoading}>
            {locLoading ? '…' : lat != null ? 'Обновить геолокацию' : 'Получить геолокацию'}
          </button>
          {lat != null && lng != null && (
            <p className="hint">Место определено</p>
          )}
        </div>
        <label className="field">
          <span className="field-label">Радиус видимости</span>
          <select
            className="input"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
          >
            {RADII.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Срок</span>
          <select
            className="input"
            value={expiresInMinutes}
            onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
          >
            <option value={15}>15 мин</option>
            <option value={30}>30 мин</option>
            <option value={60}>1 час</option>
            <option value={120}>2 часа</option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Создание…' : 'Создать заявку'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Назад
        </button>
      </form>
    </div>
  );
}
