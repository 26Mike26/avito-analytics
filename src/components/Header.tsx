import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, LogOut, RefreshCw, Search, User as UserIcon } from 'lucide-react';
import { useStore } from '../store/useStore';
import { AccountSwitcher } from './AccountSwitcher';

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const navigate = useNavigate();
  const reload = useStore((s) => s.reloadFromAdapter);
  const loading = useStore((s) => s.loading);
  const user = useStore((s) => s.currentUser);
  const logout = useStore((s) => s.logout);
  const recCount = useStore(
    (s) => s.recommendations.filter((r) => r.status === 'new' && r.priority === 'high').length
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="h-16 bg-ink-900/80 backdrop-blur border-b border-ink-800 px-6 flex items-center justify-between gap-4 relative z-10">
      <div className="min-w-0">
        <h1 className="text-[15px] font-extrabold text-white tracking-wide uppercase truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-ink-400 truncate">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-2 bg-ink-850 border border-ink-700 rounded-full px-3 h-9 w-60">
          <Search className="w-4 h-4 text-ink-500" />
          <input
            placeholder="Поиск по объявлениям..."
            className="bg-transparent flex-1 text-sm outline-none placeholder:text-ink-500 text-ink-100"
          />
        </div>
        <button
          onClick={() => reload()}
          className="btn-secondary"
          disabled={loading}
          title="Обновить данные"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">Обновить</span>
        </button>
        <Link to="/recommendations" className="btn-secondary relative" title="Уведомления">
          <Bell className="w-4 h-4" />
          {recCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
              {recCount}
            </span>
          )}
        </Link>
        <AccountSwitcher />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-9 h-9 rounded-full bg-ink-850 border border-ink-700 hover:border-accent/60 hover:bg-ink-800 flex items-center justify-center transition"
            title={user?.name ?? 'Профиль'}
          >
            <UserIcon className="w-4 h-4 text-ink-200" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 card p-2 z-30">
              <div className="px-3 py-2">
                <div className="text-sm font-semibold text-white truncate">
                  {user?.name}
                </div>
                <div className="text-xs text-ink-400 truncate">{user?.email}</div>
              </div>
              <div className="border-t border-ink-800 my-1" />
              <Link
                to="/accounts"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-sm rounded-lg text-ink-200 hover:bg-ink-850"
              >
                Управление аккаунтами
              </Link>
              <Link
                to="/log"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-sm rounded-lg text-ink-200 hover:bg-ink-850"
              >
                Журнал действий
              </Link>
              <button
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-rose-500/10 text-rose-300 inline-flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" /> Выйти
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
