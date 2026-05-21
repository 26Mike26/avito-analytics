import { useMemo, useState } from 'react';
import { BarChart3, Building2, ListChecks, MapPin } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Empty } from '../../components/Empty';
import { useStore } from '../../store/useStore';
import { visibleAccountsForUser } from '../../lib/clientAccess';
import { formatNumber, formatPercent, formatRub } from '../../lib/analytics';
import {
  categoryRowsForPeriod,
  cityRowsForPeriod,
  itemRowsForPeriod,
  type ClientMetricRow,
} from '../../lib/clientAnalytics';

type Scope = 'all' | string;

function metricText(value: number | null, kind: 'rub' | 'percent') {
  if (value == null) return '—';
  return kind === 'rub' ? formatRub(value) : formatPercent(value);
}

export default function ClientAnalytics() {
  const user = useStore((s) => s.currentUser);
  const accountsMap = useStore((s) => s.accounts);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const [scope, setScope] = useState<Scope>('all');

  const accounts = useMemo(() => visibleAccountsForUser(user, accountsMap), [accountsMap, user]);
  const scopedAccounts = useMemo(
    () => (scope === 'all' ? accounts : accounts.filter((account) => account.id === scope)),
    [accounts, scope]
  );
  const cities = useMemo(() => cityRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const categories = useMemo(
    () => categoryRowsForPeriod(scopedAccounts, period),
    [period, scopedAccounts]
  );
  const items = useMemo(() => itemRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);

  return (
    <Layout
      title="Клиентская аналитика"
      subtitle="Города, направления и объявления по выбранному периоду"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">Фильтры аналитики</div>
            <div className="text-xs text-ink-400 mt-1">
              Данные доступны только по аккаунтам, открытым для клиента.
            </div>
          </div>
          <select className="input w-full xl:w-72" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Все доступные аккаунты</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <PeriodPicker value={period} onChange={setPeriod} className="xl:justify-end" />
        </div>
      </div>

      {scopedAccounts.length === 0 ? (
        <Empty title="Нет доступных аккаунтов" hint="Администратор ещё не выдал доступ." />
      ) : (
        <div className="space-y-5">
          <AnalyticsTable icon={MapPin} title="Города" rows={cities} />
          <AnalyticsTable icon={Building2} title="Направления и подкатегории" rows={categories} />
          <AnalyticsTable icon={ListChecks} title="Объявления" rows={items.slice(0, 80)} />
        </div>
      )}
    </Layout>
  );
}

function AnalyticsTable({
  icon: Icon,
  title,
  rows,
}: {
  icon: typeof BarChart3;
  title: string;
  rows: ClientMetricRow[];
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-ink-700/70 flex items-center gap-2">
        <Icon className="w-4 h-4 text-accent" />
        <h2 className="font-semibold text-white">{title}</h2>
        <span className="text-xs text-ink-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ink-400">Данных за выбранный период пока нет.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th min-w-[260px]">Название</th>
                <th className="table-th text-right">Расход</th>
                <th className="table-th text-right">Лиды</th>
                <th className="table-th text-right">CPL</th>
                <th className="table-th text-right">CTR</th>
                <th className="table-th text-right">CR</th>
                <th className="table-th text-right">Просмотры</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="table-row">
                  <td className="table-td font-medium text-white">{row.label}</td>
                  <td className="table-td text-right">{formatRub(row.spend)}</td>
                  <td className="table-td text-right">{formatNumber(row.leads)}</td>
                  <td className="table-td text-right">{metricText(row.cpl, 'rub')}</td>
                  <td className="table-td text-right">{metricText(row.ctr, 'percent')}</td>
                  <td className="table-td text-right">{metricText(row.cr, 'percent')}</td>
                  <td className="table-td text-right">{formatNumber(row.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
