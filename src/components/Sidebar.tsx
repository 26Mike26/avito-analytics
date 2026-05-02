import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Target,
  ListChecks,
  TrendingUp,
  Lightbulb,
  BarChart3,
  Settings,
  Users,
  History,
} from 'lucide-react';

const items = [
  { to: '/', icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/kpi', icon: Target, label: 'KPI-центр' },
  { to: '/items', icon: ListChecks, label: 'Объявления' },
  { to: '/bids', icon: TrendingUp, label: 'Управление ставками' },
  { to: '/recommendations', icon: Lightbulb, label: 'Рекомендации' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
  { to: '/accounts', icon: Users, label: 'Аккаунты' },
  { to: '/log', icon: History, label: 'Журнал действий' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

export function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-ink-950/80 border-r border-ink-800 flex flex-col relative">
      <div className="px-5 h-16 flex items-center gap-3 border-b border-ink-800">
        <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center font-extrabold text-white text-sm tracking-tight">
          GA
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-extrabold text-white tracking-wide uppercase">
            Avito · Аналитика
          </div>
          <div className="text-[10px] text-ink-400 tracking-wider uppercase">
            Powered by Genesis
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition relative group',
                isActive
                  ? 'bg-ink-800 text-white'
                  : 'text-ink-300 hover:bg-ink-850 hover:text-white',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-full" />
                )}
                <item.icon
                  className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-ink-400 group-hover:text-ink-200'}`}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-ink-800 text-[10px] uppercase tracking-wider text-ink-500">
        Демо-режим · данные локальны
      </div>
    </aside>
  );
}
