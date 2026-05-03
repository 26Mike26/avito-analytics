import { CalendarRange } from 'lucide-react';
import { lastNDaysRange } from '../lib/analytics';

export type PeriodValue = { from: string; to: string };

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '3 дня', days: 3 },
  { label: '7 дней', days: 7 },
  { label: '14 дней', days: 14 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
];

/**
 * Универсальный компонент выбора периода: пресеты по дням + ручная дата от/до.
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
  const handlePreset = (days: number) => {
    onChange(lastNDaysRange(days));
  };
  const isPresetActive = (days: number) => {
    const r = lastNDaysRange(days);
    return r.from === value.from && r.to === value.to;
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <CalendarRange className="w-4 h-4 text-ink-400" />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => handlePreset(p.days)}
            className={[
              'chip transition',
              isPresetActive(p.days)
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
