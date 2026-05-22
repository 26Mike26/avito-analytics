import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, MapPin, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layout } from '../../components/Layout';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Badge } from '../../components/Badge';
import { Empty } from '../../components/Empty';
import { useStore } from '../../store/useStore';
import {
  calcConversion,
  calcCpl,
  calcCtr,
  formatNumber,
  formatPercent,
  formatRub,
} from '../../lib/analytics';
import { useClientScope } from '../../lib/clientScope';
import {
  accountItemsForPeriod,
  categoryRowsForPeriod,
  cityRowsForPeriod,
  dailyRowsForPeriod,
  type ClientMetricRow,
} from '../../lib/clientAnalytics';

type ItemQualityRow = ClientMetricRow & {
  accountName: string;
  targetCpl: number;
};

function metricText(value: number | null, kind: 'rub' | 'percent') {
  if (value == null) return '—';
  return kind === 'rub' ? formatRub(value) : formatPercent(value);
}

export default function ClientAnalytics() {
  const user = useStore((s) => s.currentUser);
  const accountsMap = useStore((s) => s.accounts);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const { scope, setScope, visibleAccounts, scopedAccounts } = useClientScope(user, accountsMap);

  const cities = useMemo(() => cityRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const categories = useMemo(
    () => categoryRowsForPeriod(scopedAccounts, period),
    [period, scopedAccounts]
  );
  const daily = useMemo(() => dailyRowsForPeriod(scopedAccounts, period), [period, scopedAccounts]);
  const series = useMemo(
    () =>
      daily.map((row) => ({
        date: row.label,
        spend: row.spend,
        cpl: row.cpl ?? 0,
        conversion: row.cr ?? 0,
        views: row.views,
        contacts: row.leads,
      })),
    [daily]
  );
  const qualityRows = useMemo<ItemQualityRow[]>(
    () =>
      scopedAccounts
        .flatMap((account) =>
          accountItemsForPeriod(account, period).map((item) => {
            const spend = Math.round(item.spend);
            const leads = item.contacts;
            const views = item.views;
            const impressions = item.impressions ?? 0;
            const cpl = calcCpl(spend, leads);
            return {
              key: `${account.id}:${item.id}`,
              label: item.title,
              accountName: account.name,
              targetCpl: account.kpi.targetCpl,
              spend,
              leads,
              views,
              impressions,
              favorites: item.favorites,
              cpl,
              cr: calcConversion(views, leads),
              ctr: calcCtr(views, impressions),
            };
          })
        )
        .filter((row) => row.spend > 0),
    [period, scopedAccounts]
  );
  const successfulItems = useMemo(
    () =>
      qualityRows
        .filter((row) => row.cpl != null && row.leads > 0 && row.cpl <= row.targetCpl)
        .sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0))
        .slice(0, 30),
    [qualityRows]
  );
  const successfulKeys = useMemo(
    () => new Set(successfulItems.map((row) => row.key)),
    [successfulItems]
  );
  const failedItems = useMemo(
    () =>
      qualityRows
        .filter((row) => {
          if (successfulKeys.has(row.key)) return false;
          return row.cpl == null || row.leads === 0 || row.cpl > row.targetCpl;
        })
        .sort((a, b) => {
          if (a.leads === 0 && b.leads > 0) return -1;
          if (b.leads === 0 && a.leads > 0) return 1;
          const aGap = a.cpl == null ? a.spend : a.cpl - a.targetCpl;
          const bGap = b.cpl == null ? b.spend : b.cpl - b.targetCpl;
          return bGap - aGap;
        })
        .slice(0, 30),
    [qualityRows, successfulKeys]
  );

  return (
    <Layout
      title="Клиентская аналитика"
      subtitle="Графики, города, направления и качество объявлений по выбранному периоду"
    >
      <div className="card p-4 sm:p-5 mb-5">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-white">Фильтры аналитики</div>
            <div className="text-xs text-ink-400 mt-1">
              Выбор аккаунта и периода общий для всех клиентских разделов.
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
          </div>
        </div>
      </div>

      {scopedAccounts.length === 0 ? (
        <Empty title="Нет доступных аккаунтов" hint="Администратор ещё не выдал доступ." />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ChartCard title="Расход по дням">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatRub(value)} />
                  <Bar dataKey="spend" fill="#FF6A00" name="Расход, ₽" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Просмотры и контакты">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="views" stroke="#60a5fa" name="Просмотры" dot={false} />
                  <Line type="monotone" dataKey="contacts" stroke="#34d399" name="Контакты" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="CPL по дням">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatRub(value)} />
                  <Line type="monotone" dataKey="cpl" stroke="#f87171" name="CPL, ₽" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Конверсия по дням, %">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatPercent(value)} />
                  <Line type="monotone" dataKey="conversion" stroke="#34d399" name="CR, %" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ItemQualityTable
              icon={TrendingUp}
              title="Успешные объявления"
              rows={successfulItems}
              tone="good"
            />
            <ItemQualityTable
              icon={TrendingDown}
              title="Неуспешные объявления"
              rows={failedItems}
              tone="bad"
            />
          </div>

          <AnalyticsTable icon={MapPin} title="Города" rows={cities} />
          <AnalyticsTable icon={Building2} title="Направления и подкатегории" rows={categories} />
        </div>
      )}
    </Layout>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <h2 className="font-semibold text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ItemQualityTable({
  icon: Icon,
  title,
  rows,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  rows: ItemQualityRow[];
  tone: 'good' | 'bad';
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-ink-700/70 flex items-center gap-2">
        <Icon className={['w-4 h-4', tone === 'good' ? 'text-emerald-300' : 'text-rose-300'].join(' ')} />
        <h2 className="font-semibold text-white">{title}</h2>
        <span className="text-xs text-ink-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ink-400">Подходящих объявлений с расходом за период нет.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th min-w-[280px]">Объявление</th>
                <th className="table-th min-w-[160px]">Аккаунт</th>
                <th className="table-th text-right">Расход</th>
                <th className="table-th text-right">Лиды</th>
                <th className="table-th text-right">CPL</th>
                <th className="table-th text-right">CTR</th>
                <th className="table-th text-right">CR</th>
                <th className="table-th">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const failed = tone === 'bad';
                return (
                  <tr key={row.key} className={['table-row', failed ? 'bg-rose-500/5' : ''].join(' ')}>
                    <td className="table-td font-medium text-white">{row.label}</td>
                    <td className="table-td">{row.accountName}</td>
                    <td className="table-td text-right">{formatRub(row.spend)}</td>
                    <td className="table-td text-right">{formatNumber(row.leads)}</td>
                    <td className="table-td text-right">
                      {metricText(row.cpl, 'rub')}
                      <div className="text-[11px] text-ink-500">цель {formatRub(row.targetCpl)}</div>
                    </td>
                    <td className="table-td text-right">{metricText(row.ctr, 'percent')}</td>
                    <td className="table-td text-right">{metricText(row.cr, 'percent')}</td>
                    <td className="table-td">
                      {failed ? (
                        row.leads === 0 ? (
                          <Badge tone="red">Нет лидов</Badge>
                        ) : (
                          <Badge tone="red">CPL выше KPI</Badge>
                        )
                      ) : (
                        <Badge tone="green">В норме</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnalyticsTable({
  icon: Icon,
  title,
  rows,
}: {
  icon: LucideIcon;
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
