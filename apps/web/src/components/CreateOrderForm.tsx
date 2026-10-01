import { useState, type FormEvent } from 'react';
import { createOrder } from '../lib/api';
import { getCurrentPosition } from '../lib/location';

const CATEGORIES = [
  { value: 'RIDE', label: 'Поездка' },
  { value: 'DELIVERY', label: 'Доставка' },
  { value: 'REPAIR', label: 'Ремонт' },
  { value: 'CLEANING', label: 'Уборка' },
  { value: 'SHOPPING', label: 'Купить / принести' },
  { value: 'COMPUTER', label: 'Компьютер' },
  { value: 'HELP', label: 'Помощь' },
  { value: 'RENTAL', label: 'Аренда' },
  { value: 'OTHER', label: 'Другое' },
] as const;

const RADII = [
  { value: 1000, label: '1 км' },
  { value: 2000, label: '2 км' },
  { value: 5000, label: '5 км' },
  { value: 10000, label: '10 км' },
  { value: 20000, label: '20 км' },
] as const;

type Props = {
  initData: string;
  onBack: () => void;
  onCreated: () => void;
};

export function CreateOrderForm({ initData, onBack, onCreated }: Props) {
  const [category, setCategory] = useState<string>('HELP');
  const [description, setDescription] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(5000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 3) {
      setError('Описание слишком короткое');
      return;
    }
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      await createOrder(initData, {
        category,
        description: description.trim(),
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        destinationText: destinationText.trim() || undefined,
        radiusMeters,
        expiresInMinutes: 30,
      });
      setOk(true);
      setTimeout(onCreated, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать заявку');
    } finally {
      setBusy(false);
    }
  }

  if (ok) {
    return (
      <div className="screen">
        <h1 className="title">Готово</h1>
        <p className="subtitle">Заявка создана и будет видна рядом около 30 минут.</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Назад
      </button>
      <h1 className="title">Мне нужно</h1>
      <p className="subtitle">Геолокация нужна только для поиска рядом и не показывается другим.</p>
      <form className="form" onSubmit={handleSubmit}>
        <label className="label">
          Категория
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Описание
          <textarea
            className="input textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Что нужно сделать?"
            maxLength={500}
            required
          />
        </label>
        <label className="label">
          Пункт назначения (необязательно)
          <input
            className="input"
            value={destinationText}
            onChange={(e) => setDestinationText(e.target.value)}
            placeholder="Адрес или ориентир"
            maxLength={300}
          />
        </label>
        <label className="label">
          Радиус
          <select
            className="input"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
          >
            {RADII.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать заявку'}
        </button>
      </form>
    </div>
  );
}
