import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Badge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PeriodPicker } from '../components/PeriodPicker';
import { useStore, type AccountApiSyncResult } from '../store/useStore';
import type { AccountData } from '../types';
import {
  calculateAccountStats,
  formatNumber,
  formatRub,
  itemsInDateRange,
  scaleKpiForPeriod,
} from '../lib/analytics';

type PeriodValue = { from: string; to: string };

function accountPeriodKey(period: PeriodValue): string {
  return `${period.from}:${period.to}`;
}

function accountViewForPeriod(account: AccountData, period: PeriodValue): AccountData {
  const snapshot = account.periodCache?.[accountPeriodKey(period)];
  if (!snapshot) return account;
  return {
    ...account,
    items: snapshot.items,
    metrics: snapshot.metrics,
    recommendations: snapshot.recommendations,
    accountCharges: snapshot.accountCharges ?? account.accountCharges ?? [],
    hasPerItemSpend: snapshot.hasPerItemSpend ?? account.hasPerItemSpend ?? false,
    spendings: snapshot.spendings ?? account.spendings ?? null,
  };
}

type AccountStatsRow = {
  account: AccountData;
  spend: number;
  leads: number;
  averageCpl: number | null;
  targetLeads: number;
  targetCpl: number;
  budget: number;
  issues: string[];
};

export default function Accounts() {
  const accounts = useStore((s) => s.accounts);
  const user = useStore((s) => s.currentUser);
  const currentId = useStore((s) => s.currentAccountId);
  const createAccount = useStore((s) => s.createAccount);
  const renameAccount = useStore((s) => s.renameAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const switchAccount = useStore((s) => s.switchAccount);
  const syncAllApiAccounts = useStore((s) => s.syncAllApiAccounts);
  const hydratePeriodCacheForAccounts = useStore((s) => s.hydratePeriodCacheForAccounts);
  const statsPeriod = useStore((s) => s.analyticsPeriod);
  const setStatsPeriod = useStore((s) => s.setAnalyticsPeriod);

  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<AccountApiSyncResult[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const userAccounts = useMemo(
    () =>
      user
        ? (user.accountIds
            .map((id) => accounts[id])
            .filter(Boolean) as AccountData[])
        : [],
    [accounts, user]
  );

  const apiAccounts = useMemo(
    () => userAccounts.filter((a) => a.integration.mode === 'api'),
    [userAccounts]
  );
  const accountIdsKey = user ? user.accountIds.join('|') : '';

  useEffect(() => {
    if (!user || user.accountIds.length === 0) return;
    let cancelled = false;
    setCacheLoading(true);
    void hydratePeriodCacheForAccounts(statsPeriod, user.accountIds).finally(() => {
      if (!cancelled) setCacheLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    accountIdsKey,
    hydratePeriodCacheForAccounts,
    statsPeriod.from,
    statsPeriod.to,
    user,
  ]);

  const accountStats = useMemo<AccountStatsRow[]>(
    () =>
      userAccounts.map((sourceAccount) => {
        const account = accountViewForPeriod(sourceAccount, statsPeriod);
        const adsTotalFromSpendings = account.spendings
          ? account.spendings.byDate
              .filter((d) => d.date >= statsPeriod.from && d.date <= statsPeriod.to)
              .reduce((sum, day) => sum + day.ads, 0)
          : null;
        const otherTotalInPeriod = account.spendings
          ? account.spendings.byDate
              .filter((d) => d.date >= statsPeriod.from && d.date <= statsPeriod.to)
              .reduce((sum, day) => sum + Math.max(0, day.total - day.ads), 0)
          : (account.accountCharges ?? [])
              .filter((charge) => charge.date >= statsPeriod.from && charge.date <= statsPeriod.to)
              .filter((charge) => charge.kind === 'account_other')
              .reduce((sum, charge) => sum + charge.amount, 0);
        const periodItems = itemsInDateRange(
          account.items,
          account.metrics,
          statsPeriod.from,
          statsPeriod.to,
          account.accountCharges,
          account.hasPerItemSpend,
          adsTotalFromSpendings,
          otherTotalInPeriod
        );
        const periodKpi = scaleKpiForPeriod(account.kpi, statsPeriod.from, statsPeriod.to);
        const stats = calculateAccountStats(periodItems, periodKpi);
        const issues: string[] = [];

        if (stats.averageCpl == null) {
          if (stats.totalSpend > 0 && stats.totalContacts === 0) {
            issues.push(`CPL: нет лидов при расходе ${formatRub(stats.totalSpend)}`);
          }
        } else if (stats.averageCpl > account.kpi.targetCpl) {
          issues.push(`CPL: ${formatRub(stats.averageCpl)} выше цели ${formatRub(account.kpi.targetCpl)}`);
        }

        return {
          account,
          spend: stats.totalSpend,
          leads: stats.totalContacts,
          averageCpl: stats.averageCpl,
          targetLeads: periodKpi.targetLeads,
          targetCpl: account.kpi.targetCpl,
          budget: periodKpi.monthlyBudget,
          issues,
        };
      }),
    [statsPeriod.from, statsPeriod.to, userAccounts]
  );

  if (!user) return null;

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

  const handleStatsPeriodChange = (nextPeriod: PeriodValue) => {
    setStatsPeriod(nextPeriod);
  };

  const saveEditedName = (account: AccountData) => {
    renameAccount(account.id, editName.trim() || account.name);
    setEditing(null);
  };

  const pendingDeleteAccount = pendingDeleteId ? accounts[pendingDeleteId] : null;

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
            className="btn-primary w-full lg:w-auto lg:shrink-0"
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

      <div className="card p-0 overflow-hidden mb-6">
        <div className="p-4 sm:p-5 border-b border-ink-700/70">
          <div className="flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-300 flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Аккаунты и KPI за период</h2>
                <p className="text-sm text-ink-400 mt-1">
                  Управление аккаунтами и сводка по затратам, лидам, CPL и выполнению KPI в одной таблице.
                </p>
                {cacheLoading && (
                  <div className="text-xs text-blue-300 mt-2">
                    Читаю сохранённую статистику из кеша периода...
                  </div>
                )}
              </div>
            </div>
            <PeriodPicker value={statsPeriod} onChange={handleStatsPeriodChange} className="xl:justify-end" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th min-w-[240px]">Название</th>
                <th className="table-th text-right">Объявлений</th>
                <th className="table-th">Режим</th>
                <th className="table-th">Создан</th>
                <th className="table-th text-right">Затраты</th>
                <th className="table-th text-right">Лиды</th>
                <th className="table-th text-right">Средний CPL</th>
                <th className="table-th min-w-[250px]">KPI</th>
                <th className="table-th text-right min-w-[260px]">Действия</th>
              </tr>
            </thead>
            <tbody>
              {accountStats.map((row) => {
                const account = row.account;
                const failed = row.issues.length > 0;
                return (
                  <tr
                    key={account.id}
                    className={[
                      'table-row',
                      failed ? 'bg-rose-500/5' : '',
                    ].join(' ')}
                  >
                    <td className="table-td">
                      {editing === account.id ? (
                        <div className="flex items-center gap-2 min-w-[220px]">
                          <input
                            autoFocus
                            className="input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditedName(account);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                          />
                          <button
                            className="btn-secondary"
                            onClick={() => saveEditedName(account)}
                            title="Сохранить название"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{account.name}</span>
                          {account.id === currentId && <Badge tone="blue">Активный</Badge>}
                          <button
                            className="text-ink-500 hover:text-accent"
                            onClick={() => {
                              setEditing(account.id);
                              setEditName(account.name);
                            }}
                            title="Переименовать"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="table-td text-right">{account.items.length}</td>
                    <td className="table-td">
                      {account.integration.mode === 'demo' && <Badge tone="amber">Демо</Badge>}
                      {account.integration.mode === 'csv' && <Badge tone="violet">CSV</Badge>}
                      {account.integration.mode === 'api' && <Badge tone="green">API</Badge>}
                    </td>
                    <td className="table-td text-ink-400">
                      {new Date(account.createdAt).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="table-td text-right text-white font-semibold">
                      {formatRub(row.spend)}
                      {row.budget > 0 && (
                        <div className="text-xs text-ink-500 font-normal">
                          бюджет {formatRub(row.budget)}
                        </div>
                      )}
                    </td>
                    <td className="table-td text-right">
                      <span className="text-white font-semibold">
                        {formatNumber(row.leads)}
                      </span>
                      <div className="text-xs text-ink-500">цель {formatNumber(row.targetLeads)}</div>
                    </td>
                    <td className="table-td text-right">
                      <span
                        className={
                          failed
                            ? 'text-rose-300 font-semibold'
                            : 'text-white font-semibold'
                        }
                      >
                        {row.averageCpl != null ? formatRub(row.averageCpl) : '—'}
                      </span>
                      <div className="text-xs text-ink-500">цель {formatRub(row.targetCpl)}</div>
                    </td>
                    <td className="table-td">
                      {failed ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-rose-300" />
                            <Badge tone="red">Не выполняется</Badge>
                          </div>
                          <div className="text-xs text-rose-200/90 leading-relaxed">
                            {row.issues.join('; ')}
                          </div>
                        </div>
                      ) : (
                        <Badge tone="green">В норме</Badge>
                      )}
                    </td>
                    <td className="table-td text-right whitespace-nowrap">
                      {account.id !== currentId && (
                        <button
                          className="btn-secondary mr-2"
                          onClick={() => switchAccount(account.id)}
                        >
                          Сделать активным
                        </button>
                      )}
                      {userAccounts.length > 1 && (
                        <button
                          className="btn-danger"
                          onClick={() => setPendingDeleteId(account.id)}
                        >
                          <Trash2 className="w-4 h-4" /> Удалить
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,420px)_auto] gap-4 lg:items-end">
          <div>
            <h2 className="font-semibold text-white mb-2">Новый аккаунт</h2>
            <p className="text-sm text-ink-300">
              Создайте отдельный аккаунт для каждого вашего профиля Авито или клиента — данные между аккаунтами не пересекаются.
            </p>
          </div>
          <input
            className="input"
            placeholder="Название аккаунта"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !draftName.trim()) return;
              const id = createAccount(draftName.trim());
              setDraftName('');
              switchAccount(id);
            }}
          />
          <button
            className="btn-primary w-full lg:w-auto"
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

      <ConfirmDialog
        open={Boolean(pendingDeleteAccount)}
        title="Удалить аккаунт?"
        description={
          pendingDeleteAccount
            ? `Аккаунт «${pendingDeleteAccount.name}» и все его данные будут удалены из платформы. Отменить действие не получится.`
            : ''
        }
        confirmText="Удалить"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteAccount) removeAccount(pendingDeleteAccount.id);
          setPendingDeleteId(null);
        }}
      />
    </Layout>
  );
}
