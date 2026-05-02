import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'good' | 'warn' | 'bad';
};

const tones = {
  default: 'text-white',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
};

export function KpiCard({ label, value, hint, icon: Icon, tone = 'default' }: Props) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-ink-400 font-semibold">
            {label}
          </div>
          <div className={`text-2xl font-extrabold mt-1 ${tones[tone]}`}>{value}</div>
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-ink-850 border border-ink-700 flex items-center justify-center text-ink-300">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      {hint && <div className="text-xs text-ink-400 mt-2">{hint}</div>}
    </div>
  );
}
