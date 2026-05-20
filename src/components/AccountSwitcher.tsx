import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useStore } from '../store/useStore';

export function AccountSwitcher() {
  const accounts = useStore((s) => s.accounts);
  const currentId = useStore((s) => s.currentAccountId);
  const switchAccount = useStore((s) => s.switchAccount);
  const user = useStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  const userAccounts = user.accountIds
    .map((id) => accounts[id])
    .filter(Boolean);
  const current = currentId ? accounts[currentId] : null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 sm:gap-2 bg-ink-850 hover:bg-ink-800 border border-ink-700 hover:border-accent/40 rounded-full px-2 sm:px-3 h-10 sm:h-9 text-sm transition"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-glow" />
        <div className="hidden md:block text-ink-400 text-[11px] uppercase tracking-wider">
          Аккаунт:
        </div>
        <div className="text-white font-semibold truncate max-w-[80px] sm:max-w-[140px]">
          {current?.name ?? 'Не выбран'}
        </div>
        <ChevronDown className="w-4 h-4 text-ink-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 card p-2 z-30">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 px-3 py-2">
            Ваши аккаунты ({userAccounts.length})
          </div>
          <ul className="max-h-72 overflow-auto">
            {userAccounts.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => {
                    switchAccount(a.id);
                    setOpen(false);
                  }}
                  className={[
                    'w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition',
                    a.id === currentId
                      ? 'bg-ink-850 text-white'
                      : 'hover:bg-ink-850 text-ink-200',
                  ].join(' ')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{a.name}</div>
                    <div className="text-[11px] text-ink-400">
                      {a.items.length} объявлений · режим {a.integration.mode}
                    </div>
                  </div>
                  {a.id === currentId && <Check className="w-4 h-4 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-800 mt-2 pt-2 flex gap-1">
            <Link
              to="/accounts"
              onClick={() => setOpen(false)}
              className="btn-ghost flex-1 justify-start"
            >
              <Plus className="w-4 h-4" /> Добавить аккаунт
            </Link>
            <Link
              to="/accounts"
              onClick={() => setOpen(false)}
              className="btn-ghost"
              title="Управление аккаунтами"
            >
              <SettingsIcon className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
