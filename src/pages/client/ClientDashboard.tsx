import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarDays,
  Heart,
  Loader2,
  Percent,
  RefreshCw,
  Target,
  Wallet,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge } from '../../components/Badge';
import { Empty } from '../../components/Empty';
import { useStore } from '../../store/useStore';
import { formatNumber, formatPercent, formatRub } from '../../lib/analytics';
import { useClientScope } from '../../lib/clientScope';
import {
  accountRowForPeriod,
  allTimeRow,
  dailyRowsForPeriod,
  totalRowForPeriod,
  weeklyRowsFromDaily,
  type ClientMetricRow,
} from '../../lib/clientAnalytics';

function metricText(value: number | null, kind: 'rub' | 'number' | 'percent') {
  if (value == null) return '—';
  if (kind === 'rub') return formatRub(value);
  if (kind === 'percent') return formatPercent(value);
  return formatNumber(value);
}

export default function ClientDashboard() {
  const user = useStore((s) => s.currentUser);
  const accountsMap = useStore((s) => s.accounts);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const loading = useStore((s) => s.loading);
  const syncAllApiAccounts = useStore((s) => s.syncAllApiAccounts);
  const hydratePeriodCacheForAccounts = useStore((s) => s.hydratePeriodCacheForAccounts);
  const clientShareToken = useStore((s) => s.clientShareToken);
  const refreshClientSharePeriod = useStore((s) => s.refreshClientSharePeriod);
  const { scope, setScope, visibleAccounts, scopedAccounts } = useClientScope(user, accountsMap);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const total = useMemo(() => totalRowForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const allTime = useMemo(() => allTimeRow(scopedAccounts), [scopedAccounts]);
  const accountRows = useMemo(
    () => scopedAccounts.map((account) => accountRowForPeriod(account, period)),
    [period, scopedAccounts]
  );
  const daily = useMemo(() => dailyRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const weekly = useMemo(() => weeklyRowsFromDaily(daily), [daily]);
  const balance = useMemo(() => {
    const accountsWithBalance = scopedAccounts.filter((account) => account.balance);
    const real = accountsWithBalance.reduce((sum, account) => sum + (account.balance?.real ?? 0), 0);
    const bonus = accountsWithBalance.reduce((sum, account) => sum + (account.balance?.bonus ?? 0), 0);
    const balanceDates = accountsWithBalance
      .map((account) => account.balance?.fetchedAt)
      .filter(Boolean)
      .sort();
    const latest = balanceDates.length > 0 ? balanceDates[balanceDates.length - 1] : undefined;
    return {
      loaded: accountsWithBalance.length > 0,
      real,
      bonus,
      latest,
    };
  }, [scopedAccounts]);

  const refreshPeriod = async () => {
    if (visibleAccounts.length === 0) return;
    setRefreshNote(null);
    // Клиент по share-ссылке — read-only: API не синхронизируем, тянем
    // точную статистику за период через RPC.
    if (clientShareToken) {
      await refreshClientSharePeriod(period);
      setRefreshNote('Данные за период обновлены.');
      return;
    }
    const ids = visibleAccounts.map((account) => account.id);
    const results = await syncAllApiAccounts();
    await hydratePeriodCacheForAccounts(period, ids);
    const success = results.filter((row) => row.status === 'success').length;
    const errors = results.filter((row) => row.status === 'error').length;
    const skipped = results.filter((row) => row.status === 'skipped').length;
    setRefreshNote(
      `Обновление завершено: ${success} успешно, ${errors} ошибок, ${skipped} пропущено.`
    );
  };

  return (
    <Layout
      title="Клиентский дашборд"
      subtitle="Затраты, баланс, лиды и динамика по доступным аккаунтам"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-white">Период и аккаунты</div>
            <div className="text-xs text-ink-400 mt-1">
              Доступно аккаунтов: {visibleAccounts.length}. Выбор сохраняется при переходе между разделами.
            </div>
          </div>
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <select
              className="input w-full xl:w-72 xl:shrink-0"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="all">Все доступные аккаунты</option>
              {visibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <PeriodPicker value={period} onChange={setPeriod} className="xl:flex-1 xl:justify-end" />
            <button
              onClick={refreshPeriod}
              className="btn-secondary w-full xl:w-auto xl:shrink-0"
              disabled={loading || visibleAccounts.length === 0}
              title="Обновить доступные API-аккаунты и подтянуть кеш выбранного периода"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {loading ? 'Обновляю...' : 'Обновить данные за период'}
            </button>
          </div>
        </div>
        {refreshNote && <div className="text-xs text-ink-400 mt-3">{refreshNote}</div>}
      </div>

      {scopedAccounts.length === 0 ? (
        <Empty
          title="Нет доступных аккаунтов"
          hint="Попросите администратора выдать клиентский доступ к нужным аккаунтам."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3 mb-5">
            <MetricCard
              icon={Wallet}
              label="Реальный баланс"
              value={balance.loaded ? formatRub(balance.real) : '—'}
              hint={
                balance.loaded
                  ? `Бонусы: ${formatRub(balance.bonus)}${
                      balance.latest
                        ? ` · обновлено ${new Date(balance.latest).toLocaleString('ru-RU')}`
                        : ''
                    }`
                  : 'Баланс появится после API-обновления'
              }
              tone="green"
            />
            <MetricCard
              icon={BarChart3}
              label="Затраты за весь срок"
              value={formatRub(allTime.spend)}
              hint="Сумма по всем загруженным данным"
              tone="orange"
            />
            <MetricCard
              icon={CalendarDays}
              label="Затраты периода"
              value={formatRub(total.spend)}
              hint={`${period.from} — ${period.to}`}
              tone="blue"
            />
            <MetricCard
              icon={Target}
              label="Лиды"
              value={formatNumber(total.leads)}
              hint={`Средний CPL: ${metricText(total.cpl, 'rub')}`}
              tone="white"
            />
            <MetricCard
              icon={Percent}
              label="Конверсия"
              value={metricText(total.cr, 'percent')}
              hint={`CTR: ${metricText(total.ctr, 'percent')}`}
              tone="violet"
            />
            <MetricCard
              icon={Heart}
              label="Избранное"
              value={formatNumber(total.favorites)}
              hint={`Просмотры: ${formatNumber(total.views)}`}
              tone="rose"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <MetricTable title="Сравнение по дням" rows={daily.slice(-14).reverse()} />
            <MetricTable title="Сравнение по неделям" rows={weekly.slice(-8).reverse()} />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-ink-700/70">
              <h2 className="font-semibold text-white">Статистика по аккаунтам</h2>
              <p className="text-sm text-ink-400 mt-1">
                Красная метка появляется только если средний CPL выше KPI аккаунта.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="table-th min-w-[220px]">Аккаунт</th>
                    <th className="table-th text-right">Затраты</th>
                    <th className="table-th text-right">Лиды</th>
                    <th className="table-th text-right">CPL</th>
                    <th className="table-th text-right">CTR</th>
                    <th className="table-th text-right">CR</th>
                    <th className="table-th">KPI</th>
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map((row) => (
                    <tr
                      key={row.key}
                      className={['table-row', row.kpiFailed ? 'bg-rose-500/5' : ''].join(' ')}
                    >
                      <td className="table-td font-medium text-white">{row.label}</td>
                      <td className="table-td text-right">{formatRub(row.spend)}</td>
                      <td className="table-td text-right">
                        {formatNumber(row.leads)}
                        <div className="text-[11px] text-ink-500">цель {formatNumber(row.targetLeads)}</div>
                      </td>
                      <td className="table-td text-right">
                        {metricText(row.cpl, 'rub')}
                        <div className="text-[11px] text-ink-500">цель {formatRub(row.targetCpl)}</div>
                      </td>
                      <td className="table-td text-right">{metricText(row.ctr, 'percent')}</td>
                      <td className="table-td text-right">{metricText(row.cr, 'percent')}</td>
                      <td className="table-td">
                        {row.kpiFailed ? (
                          <Badge tone="red">CPL выше KPI</Badge>
                        ) : (
                          <Badge tone="green">В норме</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: 'white' | 'green' | 'orange' | 'blue' | 'violet' | 'rose';
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
      : tone === 'orange'
      ? 'border-accent/30 bg-accent/5 text-accent'
      : tone === 'blue'
      ? 'border-blue-500/30 bg-blue-500/5 text-blue-300'
      : tone === 'violet'
      ? 'border-violet-500/30 bg-violet-500/5 text-violet-300'
      : tone === 'rose'
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
      : 'border-ink-700 bg-ink-850 text-white';
  return (
    <div className={`card border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-ink-400 text-xs uppercase tracking-wider">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="text-2xl font-extrabold mt-2">{value}</div>
      <div className="text-xs text-ink-400 mt-1 leading-relaxed">{hint}</div>
    </div>
  );
}

function MetricTable({ title, rows }: { title: string; rows: ClientMetricRow[] }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-4 border-b border-ink-700/70 font-semibold text-white">{title}</div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ink-400">Данных за выбранный период пока нет.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th min-w-[130px]">Период</th>
                <th className="table-th text-right">Расход</th>
                <th className="table-th text-right">Лиды</th>
                <th className="table-th text-right">CPL</th>
                <th className="table-th text-right">CR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="table-row">
                  <td className="table-td">{row.label}</td>
                  <td className="table-td text-right">{formatRub(row.spend)}</td>
                  <td className="table-td text-right">{formatNumber(row.leads)}</td>
                  <td className="table-td text-right">{metricText(row.cpl, 'rub')}</td>
                  <td className="table-td text-right">{metricText(row.cr, 'percent')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
