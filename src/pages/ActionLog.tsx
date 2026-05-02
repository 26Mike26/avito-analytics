import { useMemo, useState } from 'react';
import { Download, History, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { useStore } from '../store/useStore';
import type { ActionLogEntry, ActionType } from '../types';

const TYPE_LABELS: Record<ActionType, string> = {
  login: 'Вход',
  logout: 'Выход',
  signup: 'Регистрация',
  account_created: 'Аккаунт создан',
  account_renamed: 'Переименование',
  account_removed: 'Аккаунт удалён',
  account_switched: 'Переключение',
  kpi_changed: 'KPI изменены',
  item_bid_changed: 'Ставка изменена',
  item_bid_bulk_applied: 'Массовое применение',
  recommendation_accepted: 'Рекомендация принята',
  recommendation_declined: 'Рекомендация отклонена',
  recommendation_postponed: 'Рекомендация отложена',
  csv_imported: 'Импорт CSV',
  integration_updated: 'Интеграция',
  item_note_set: 'Заметка',
  data_reloaded: 'Синхронизация',
  reset_to_demo: 'Сброс к демо',
};

const TYPE_TONES: Partial<Record<ActionType, 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'violet'>> =
  {
    login: 'green',
    logout: 'gray',
    signup: 'green',
    account_created: 'blue',
    account_renamed: 'blue',
    account_removed: 'red',
    account_switched: 'blue',
    kpi_changed: 'amber',
    item_bid_changed: 'amber',
    item_bid_bulk_applied: 'amber',
    recommendation_accepted: 'green',
    recommendation_declined: 'gray',
    recommendation_postponed: 'amber',
    csv_imported: 'violet',
    integration_updated: 'blue',
    item_note_set: 'gray',
    data_reloaded: 'blue',
    reset_to_demo: 'amber',
  };

export default function ActionLog() {
  const log = useStore((s) => s.actionLog);
  const accounts = useStore((s) => s.accounts);
  const currentId = useStore((s) => s.currentAccountId);
  const clearLog = useStore((s) => s.clearLog);

  const [accountFilter, setAccountFilter] = useState<string>(currentId ?? 'all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const types = useMemo(() => Array.from(new Set(log.map((l) => l.type))), [log]);

  const filtered = log.filter((l) => {
    if (accountFilter !== 'all' && l.accountId !== accountFilter) return false;
    if (typeFilter !== 'all' && l.type !== typeFilter) return false;
    if (
      search &&
      !(l.title.toLowerCase().includes(search.toLowerCase()) ||
        (l.details ?? '').toLowerCase().includes(search.toLowerCase()))
    )
      return false;
    return true;
  });

  const exportCsv = () => {
    const headers = ['timestamp', 'type', 'account', 'title', 'details'];
    const rows = filtered.map((l) => [
      l.timestamp,
      l.type,
      l.accountId ? accounts[l.accountId]?.name ?? l.accountId : '',
      l.title.replace(/"/g, '""'),
      (l.details ?? '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join(
      '\n'
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      title="Журнал действий"
      subtitle="Все изменения, которые делали в этом профиле — для аудита и контроля"
    >
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <select
          className="input w-auto"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">Все аккаунты</option>
          {Object.values(accounts).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Любой тип</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          className="input w-64"
          placeholder="Поиск по описанию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Экспорт CSV
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm('Очистить журнал действий? Это нельзя отменить.')) clearLog();
            }}
          >
            <Trash2 className="w-4 h-4" /> Очистить
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Записей нет"
          hint="Здесь появятся все действия — изменения KPI, ставок, импорты и переключения."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Дата и время</th>
                  <th className="table-th">Тип</th>
                  <th className="table-th">Аккаунт</th>
                  <th className="table-th">Описание</th>
                  <th className="table-th">Детали</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <LogRow key={entry.id} entry={entry} accountName={entry.accountId ? accounts[entry.accountId]?.name ?? '—' : '—'} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}

function LogRow({ entry, accountName }: { entry: ActionLogEntry; accountName: string }) {
  const tone = TYPE_TONES[entry.type] ?? 'gray';
  return (
    <tr className="table-row align-top">
      <td className="table-td whitespace-nowrap text-ink-400">
        {new Date(entry.timestamp).toLocaleString('ru-RU')}
      </td>
      <td className="table-td">
        <Badge tone={tone}>{TYPE_LABELS[entry.type] ?? entry.type}</Badge>
      </td>
      <td className="table-td whitespace-nowrap">{accountName}</td>
      <td className="table-td">{entry.title}</td>
      <td className="table-td text-ink-400">
        {entry.details}
        {(entry.before !== undefined || entry.after !== undefined) && (
          <details className="mt-1">
            <summary className="text-xs text-accent hover:underline cursor-pointer">
              Подробнее
            </summary>
            <pre className="text-[11px] bg-ink-850 border border-ink-700 rounded-md p-2 mt-1 max-w-[420px] overflow-auto">
{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
            </pre>
          </details>
        )}
      </td>
    </tr>
  );
}
