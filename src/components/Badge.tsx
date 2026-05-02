import { ReactNode } from 'react';

type Tone = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'violet' | 'orange';

const toneClass: Record<Tone, string> = {
  gray: 'bg-ink-800 text-ink-300 border border-ink-700',
  blue: 'bg-blue-500/10 text-blue-300 border border-blue-500/30',
  green: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
  red: 'bg-rose-500/10 text-rose-300 border border-rose-500/30',
  amber: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
  violet: 'bg-violet-500/10 text-violet-300 border border-violet-500/30',
  orange: 'bg-accent/10 text-accent-200 border border-accent/40',
};

export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`chip ${toneClass[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: 'active' | 'paused' | 'archived' }) {
  if (status === 'active') return <Badge tone="green">Активно</Badge>;
  if (status === 'paused') return <Badge tone="amber">Приостановлено</Badge>;
  return <Badge tone="gray">В архиве</Badge>;
}

export function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  if (priority === 'high') return <Badge tone="red">Высокий</Badge>;
  if (priority === 'medium') return <Badge tone="amber">Средний</Badge>;
  return <Badge tone="gray">Низкий</Badge>;
}
