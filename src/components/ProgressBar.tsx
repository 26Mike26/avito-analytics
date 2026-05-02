type Props = {
  value: number; // 0..100+
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'orange';
};

const tones = {
  blue: 'bg-blue-400',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  orange: 'bg-accent',
};

export function ProgressBar({ value, tone = 'orange' }: Props) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full h-1.5 bg-ink-800 rounded-full overflow-hidden">
      <div
        className={`h-full ${tones[tone]} transition-all`}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
