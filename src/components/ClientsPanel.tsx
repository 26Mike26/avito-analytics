import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Plus,
  ShieldOff,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Badge } from './Badge';
import { ConfirmDialog } from './ConfirmDialog';
import type { AccountData, ClientShare } from '../types';
import {
  buildClientShareUrl,
  clientShareStatus,
  createClientShare,
  deleteClientShare,
  listClientShares,
  revokeClientShare,
} from '../services/ClientShareService';

type Props = {
  ownerUserId: string;
  accounts: AccountData[];
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

export function ClientsPanel({ ownerUserId, accounts }: Props) {
  const [shares, setShares] = useState<ClientShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClientShare | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ClientShare | null>(null);

  const accountMap = useMemo(() => {
    const map: Record<string, AccountData> = {};
    accounts.forEach((account) => {
      map[account.id] = account;
    });
    return map;
  }, [accounts]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShares(await listClientShares(ownerUserId));
    } catch {
      setError('Не удалось загрузить список доступов.');
    } finally {
      setLoading(false);
    }
  }, [ownerUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setLabel('');
    setSelectedIds([]);
    setExpiresAt('');
    setCreating(false);
  };

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const canCreate =
    label.trim().length > 0 && selectedIds.length > 0 && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await createClientShare({
        ownerUserId,
        label: label.trim(),
        accountIds: selectedIds,
        expiresAt: expiresAt
          ? new Date(`${expiresAt}T23:59:59`).toISOString()
          : null,
      });
      resetForm();
      await refresh();
    } catch {
      setError('Не удалось создать доступ.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (share: ClientShare) => {
    const url = buildClientShareUrl(share.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(share.id);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === share.id ? null : cur)),
        2000
      );
    } catch {
      // Буфер обмена может быть недоступен — ссылку всё равно видно в поле.
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="card p-4 sm:p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-300 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Доступы для клиентов</h2>
              <p className="text-sm text-ink-400 mt-1">
                Создайте ссылку — клиент откроет её и увидит ограниченный кабинет
                (дашборд, аналитику, рекомендации и журнал) только по выбранным
                аккаунтам, в режиме просмотра. Отдельный логин и пароль не нужны.
              </p>
            </div>
          </div>
          {!creating && (
            <button
              className="btn-primary w-full lg:w-auto lg:shrink-0"
              onClick={() => setCreating(true)}
            >
              <Plus className="w-4 h-4" /> Создать доступ
            </button>
          )}
        </div>

        {creating && (
          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-white">Новый доступ</h3>
              <button
                className="text-ink-500 hover:text-white"
                onClick={resetForm}
                title="Отмена"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block text-xs text-ink-400 mb-1">
              Название (имя клиента или компании)
            </label>
            <input
              autoFocus
              className="input mb-4"
              placeholder="Напр.: ООО «Ромашка»"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />

            <div className="text-xs text-ink-400 mb-1">Доступные аккаунты</div>
            {accounts.length === 0 ? (
              <p className="text-sm text-ink-500 mb-4">
                Сначала создайте хотя бы один аккаунт на вкладке «Аккаунты».
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                {accounts.map((account) => {
                  const checked = selectedIds.includes(account.id);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => toggleAccount(account.id)}
                      className={[
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors',
                        checked
                          ? 'border-accent/50 bg-accent/10 text-white'
                          : 'border-ink-700 bg-ink-900/40 text-ink-300 hover:border-ink-600',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'w-4 h-4 rounded flex items-center justify-center shrink-0 border',
                          checked
                            ? 'bg-accent border-accent text-white'
                            : 'border-ink-600',
                        ].join(' ')}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="truncate">{account.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <label className="block text-xs text-ink-400 mb-1">
              Действует до (необязательно)
            </label>
            <input
              type="date"
              className="input mb-4 sm:max-w-[220px]"
              min={todayIso}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />

            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                onClick={() => void handleCreate()}
                disabled={!canCreate}
                title={
                  canCreate
                    ? 'Создать доступ-ссылку'
                    : 'Укажите название и выберите хотя бы один аккаунт'
                }
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                {saving ? 'Создаю...' : 'Создать ссылку'}
              </button>
              <button className="btn-secondary" onClick={resetForm}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
      </div>

      {loading ? (
        <div className="card p-8 text-center text-sm text-ink-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Загружаю доступы...
        </div>
      ) : shares.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-ink-800 text-ink-400 flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6" />
          </div>
          <p className="text-sm text-ink-400">
            Пока нет ни одного клиентского доступа. Нажмите «Создать доступ»,
            чтобы выдать клиенту ссылку на ограниченный кабинет.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {shares.map((share) => {
            const status = clientShareStatus(share);
            const url = buildClientShareUrl(share.token);
            return (
              <div key={share.id} className="card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white truncate">
                        {share.label}
                      </span>
                      {status === 'active' && <Badge tone="green">Активна</Badge>}
                      {status === 'revoked' && <Badge tone="red">Отозвана</Badge>}
                      {status === 'expired' && <Badge tone="amber">Истекла</Badge>}
                    </div>
                    <div className="text-xs text-ink-500 mt-1">
                      Создана {formatDate(share.createdAt)}
                      {share.expiresAt
                        ? ` · действует до ${formatDate(share.expiresAt)}`
                        : ' · бессрочно'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {share.accountIds.map((id) => (
                    <span
                      key={id}
                      className="chip bg-ink-800 text-ink-300 border border-ink-700"
                    >
                      {accountMap[id]?.name ?? 'Удалённый аккаунт'}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <input
                    readOnly
                    className="input flex-1 text-xs text-ink-400"
                    value={url}
                    onFocusCapture={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    onClick={() => void handleCopy(share)}
                    disabled={status !== 'active'}
                    title={
                      status === 'active'
                        ? 'Скопировать ссылку'
                        : 'Доступ неактивен'
                    }
                  >
                    {copiedId === share.id ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    {copiedId === share.id ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {status === 'active' && (
                    <button
                      className="btn-secondary"
                      onClick={() => setPendingRevoke(share)}
                    >
                      <ShieldOff className="w-4 h-4" /> Отозвать
                    </button>
                  )}
                  <button
                    className="btn-danger"
                    onClick={() => setPendingDelete(share)}
                  >
                    <Trash2 className="w-4 h-4" /> Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        title="Отозвать доступ?"
        description={
          pendingRevoke
            ? `Ссылка доступа «${pendingRevoke.label}» перестанет работать. Запись останется в списке.`
            : ''
        }
        confirmText="Отозвать"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const target = pendingRevoke;
          setPendingRevoke(null);
          if (!target) return;
          void (async () => {
            try {
              await revokeClientShare(target.id);
              await refresh();
            } catch {
              setError('Не удалось отозвать доступ.');
            }
          })();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Удалить доступ?"
        description={
          pendingDelete
            ? `Доступ «${pendingDelete.label}» будет удалён без возможности восстановления.`
            : ''
        }
        confirmText="Удалить"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void (async () => {
            try {
              await deleteClientShare(target.id);
              await refresh();
            } catch {
              setError('Не удалось удалить доступ.');
            }
          })();
        }}
      />
    </>
  );
}
