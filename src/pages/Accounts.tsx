import { useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge } from '../components/Badge';
import { useStore } from '../store/useStore';

export default function Accounts() {
  const accounts = useStore((s) => s.accounts);
  const user = useStore((s) => s.currentUser);
  const currentId = useStore((s) => s.currentAccountId);
  const createAccount = useStore((s) => s.createAccount);
  const renameAccount = useStore((s) => s.renameAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const switchAccount = useStore((s) => s.switchAccount);

  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (!user) return null;
  const userAccounts = user.accountIds
    .map((id) => accounts[id])
    .filter(Boolean);

  return (
    <Layout
      title="Аккаунты"
      subtitle="Список рекламных аккаунтов, привязанных к вашему профилю"
    >
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
