import { useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Target, Wallet } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge } from '../../components/Badge';
import { Empty } from '../../components/Empty';
import { useStore } from '../../store/useStore';
import { visibleAccountsForUser } from '../../lib/clientAccess';
import { formatNumber, formatPercent, formatRub } from '../../lib/analytics';
import {
  accountRowForPeriod,
  allTimeRow,
  dailyRowsForPeriod,
  totalRowForPeriod,
  weeklyRowsFromDaily,
  type ClientMetricRow,
} from '../../lib/clientAnalytics';

type Scope = 'all' | string;

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
  const [scope, setScope] = useState<Scope>('all');

  const visibleAccounts = useMemo(
    () => visibleAccountsForUser(user, accountsMap),
    [accountsMap, user]
  );
  const scopedAccounts = useMemo(
    () =>
      scope === 'all'
        ? visibleAccounts
        : visibleAccounts.filter((account) => account.id === scope),
    [scope, visibleAccounts]
  );
  const total = useMemo(() => totalRowForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const allTime = useMemo(() => allTimeRow(scopedAccounts), [scopedAccounts]);
  const accountRows = useMemo(
    () => scopedAccounts.map((account) => accountRowForPeriod(account, period)),
    [period, scopedAccounts]
  );
  const daily = useMemo(() => dailyRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const weekly = useMemo(() => weeklyRowsFromDaily(daily), [daily]);

  return (
    <Layout
      title="Клиентский дашборд"
      subtitle="Затраты, лиды, CPL и динамика по доступным аккаунтам"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">Период и аккаунты</div>
            <div className="text-xs text-ink-400 mt-1">
              Доступно аккаунтов: {visibleAccounts.length}. Можно смотреть общую картину или один аккаунт отдельно.
            </div>
          </div>
          <select
            className="input w-full xl:w-72"
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
          <PeriodPicker value={period} onChange={setPeriod} className="xl:justify-end" />
        </div>
      </div>

      {scopedAccounts.length === 0 ? (
        <Empty
          title="Нет доступных аккаунтов"
          hint="Попросите администратора выдать клиентский доступ к нужным аккаунтам."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            <MetricCard icon={Wallet} label="Затраты за весь срок" value={formatRub(allTime.spend)} />
            <MetricCard icon={CalendarDays} label="Затраты за период" value={formatRub(total.spend)} />
            <MetricCard icon={Target} label="Лиды за период" value={formatNumber(total.leads)} />
            <MetricCard icon={BarChart3} label="Средний CPL" value={metricText(total.cpl, 'rub')} />
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
                    <tr key={row.key} className={['table-row', row.kpiFailed ? 'bg-rose-500/5' : ''].join(' ')}>
                      <td className="table-td font-medium text-white">{row.label}</td>
                      <td className="table-td text-right">{formatRub(row.spend)}</td>
                      <td className="table-td text-right">{formatNumber(row.leads)}</td>
                      <td className="table-td text-right">{metricText(row.cpl, 'rub')}</td>
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
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-ink-400 text-xs uppercase tracking-wider">
        <Icon className="w-4 h-4 text-accent" />
        {label}
      </div>
      <div className="text-2xl font-extrabold text-white mt-2">{value}</div>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="table-row">
                  <td className="table-td">{row.label}</td>
                  <td className="table-td text-right">{formatRub(row.spend)}</td>
                  <td className="table-td text-right">{formatNumber(row.leads)}</td>
                  <td className="table-td text-right">{metricText(row.cpl, 'rub')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
