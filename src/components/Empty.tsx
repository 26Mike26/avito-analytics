import { Inbox } from 'lucide-react';
import { ReactNode } from 'react';

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card p-10 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-ink-850 border border-ink-700 flex items-center justify-center mb-3">
        <Inbox className="w-5 h-5 text-ink-400" />
      </div>
      <div className="font-semibold text-white">{title}</div>
      {hint && <div className="text-sm text-ink-400 mt-1 max-w-md">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
