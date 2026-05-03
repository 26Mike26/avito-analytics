import { CalendarRange } from 'lucide-react';
import { lastNDaysRange } from '../lib/analytics';

export type PeriodValue = { from: string; to: string };

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Готовые пресеты периода. Каждый возвращает {from, to} (включительно).
 */
const PRESETS: Array<{ label: string; range: () => PeriodValue }> = [
  {
    label: 'Сегодня',
    range: () => {
      const t = fmt(new Date());
      return { from: t, to: t };
    },
  },
  {
    label: 'Вчера',
    range: () => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const s = fmt(y);
      return { from: s, to: s };
    },
  },
  { label: '7 дней', range: () => lastNDaysRange(7) },
  { label: '14 дней', range: () => lastNDaysRange(14) },
  { label: '30 дней', range: () => lastNDaysRange(30) },
  { label: '90 дней', range: () => lastNDaysRange(90) },
  {
    label: 'Этот месяц',
    range: () => {
      const t = new Date();
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      return { from: fmt(start), to: fmt(t) };
    },
  },
];

/**
 * Универсальный компонент выбора периода: пресеты + ручные даты.
 * Возвращает { from, to } в формате YYYY-MM-DD.
 */
export function PeriodPicker({
  value,
  onChange,
  className = '',
}: {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  className?: string;
}) {
  const isActive = (preset: () => PeriodValue) => {
    const r = preset();
    return r.from === value.from && r.to === value.to;
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <CalendarRange className="w-4 h-4 text-ink-400" />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.range())}
            className={[
              'chip transition',
              isActive(p.range)
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-ink-800 text-ink-300 border border-ink-700 hover:text-white',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 ml-1">
        <input
          type="date"
          className="input w-auto py-1.5 text-xs"
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span className="text-ink-500">—</span>
        <input
          type="date"
          className="input w-auto py-1.5 text-xs"
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Утилита: вернуть «вчера» в формате { from, to } — иногда нужно в коде. */
export function yesterdayRange(): PeriodValue {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const s = fmt(y);
  return { from: s, to: s };
}
