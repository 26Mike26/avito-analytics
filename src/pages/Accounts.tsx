import { useState } from 'react';
import { Check, Loader2, Pencil, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge } from '../components/Badge';
import { useStore, type AccountApiSyncResult } from '../store/useStore';

export default function Accounts() {
  const accounts = useStore((s) => s.accounts);
  const user = useStore((s) => s.currentUser);
  const currentId = useStore((s) => s.currentAccountId);
  const createAccount = useStore((s) => s.createAccount);
  const renameAccount = useStore((s) => s.renameAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const switchAccount = useStore((s) => s.switchAccount);
  const syncAllApiAccounts = useStore((s) => s.syncAllApiAccounts);

  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<AccountApiSyncResult[]>([]);

  if (!user) return null;
  const userAccounts = user.accountIds
    .map((id) => accounts[id])
    .filter(Boolean);
  const apiAccounts = userAccounts.filter((a) => a.integration.mode === 'api');

  const runBulkSync = async () => {
    setSyncing(true);
    setSyncResults([]);
    try {
      const results = await syncAllApiAccounts();
      setSyncResults(results);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Layout
      title="Аккаунты"
      subtitle="Список рекламных аккаунтов, привязанных к вашему профилю"
    >
      <div className="card p-4 sm:p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Wifi className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Проверка API и обновление всех аккаунтов</h2>
              <p className="text-sm text-ink-400 mt-1">
                Одной кнопкой проверяем подключение по API во всех действующих API-аккаунтах и обновляем объявления, статистику, ставки, баланс и расходы.
              </p>
              <div className="text-xs text-ink-500 mt-2">
                API-аккаунтов: {apiAccounts.length} из {userAccounts.length}. Текущий активный аккаунт не переключается.
              </div>
            </div>
          </div>
          <button
            className="btn-primary lg:shrink-0"
            onClick={runBulkSync}
            disabled={syncing || apiAccounts.length === 0}
            title={apiAccounts.length === 0 ? 'Нет аккаунтов в режиме API' : 'Проверить API и обновить данные во всех API-аккаунтах'}
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? 'Проверяю и обновляю...' : 'Проверить API и обновить все'}
          </button>
        </div>

        {syncResults.length > 0 && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {syncResults.map((result) => (
              <div
                key={result.accountId}
                className={[
                  'rounded-lg border px-3 py-2 text-sm',
                  result.status === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : result.status === 'skipped'
                    ? 'border-ink-700 bg-ink-900/60'
                    : 'border-rose-500/30 bg-rose-500/5',
                ].join(' ')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white truncate">{result.accountName}</span>
                  {result.status === 'success' && <Badge tone="green">OK</Badge>}
                  {result.status === 'skipped' && <Badge tone="gray">Пропущен</Badge>}
                  {result.status === 'error' && <Badge tone="red">Ошибка</Badge>}
                </div>
                <div className="text-xs text-ink-400">
                  {result.message}
                  {result.items != null ? ` · объявлений: ${result.items}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Название</th>
                <th className="table-th">Объявлений</th>
                <th className="table-th">Режим</th>
                <th className="table-th">Создан</th>
                <th className="table-th text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {userAccounts.map((a) => (
                <tr key={a.id} className="table-row">
                  <td className="table-td">
                    {editing === a.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          className="input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameAccount(a.id, editName.trim() || a.name);
                              setEditing(null);
                            }
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            renameAccount(a.id, editName.trim() || a.name);
                            setEditing(null);
                          }}
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{a.name}</span>
                        {a.id === currentId && <Badge tone="blue">Активный</Badge>}
                        <button
                          className="text-ink-500 hover:text-accent"
                          onClick={() => {
                            setEditing(a.id);
                            setEditName(a.name);
                          }}
                          title="Переименовать"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="table-td">{a.items.length}</td>
                  <td className="table-td">
                    {a.integration.mode === 'demo' && <Badge tone="amber">Демо</Badge>}
                    {a.integration.mode === 'csv' && <Badge tone="violet">CSV</Badge>}
                    {a.integration.mode === 'api' && <Badge tone="green">API</Badge>}
                  </td>
                  <td className="table-td text-ink-400">
                    {new Date(a.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="table-td text-right whitespace-nowrap">
                    {a.id !== currentId && (
                      <button
                        className="btn-secondary mr-2"
                        onClick={() => switchAccount(a.id)}
                      >
                        Сделать активным
                      </button>
                    )}
                    {userAccounts.length > 1 && (
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Удалить аккаунт «${a.name}»? Все его данные будут стёрты.`)) {
                            removeAccount(a.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" /> Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5 h-fit">
          <h2 className="font-semibold text-white mb-3">Новый аккаунт</h2>
          <p className="text-sm text-ink-300 mb-3">
            Создайте отдельный аккаунт для каждого вашего профиля Авито или клиента —
            данные между аккаунтами не пересекаются.
          </p>
          <input
            className="input mb-2"
            placeholder="Название аккаунта"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <button
            className="btn-primary w-full"
            onClick={() => {
              if (!draftName.trim()) return;
              const id = createAccount(draftName.trim());
              setDraftName('');
              switchAccount(id);
            }}
          >
            <Plus className="w-4 h-4" /> Создать и переключиться
          </button>
        </div>
      </div>
    </Layout>
  );
}
