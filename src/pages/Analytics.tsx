import { useMemo, useState } from 'react';
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
import { Layout } from '../components/Layout';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge } from '../components/Badge';
import { useStore } from '../store/useStore';
import {
  aggregateMetricsByDate,
  calcCpl,
  calculateAccountStats,
  categoryAverages,
  formatNumber,
  formatPercent,
  formatRub,
  itemsInDateRange,
  lastNDaysRange,
  regionAverages,
} from '../lib/analytics';
import { ProgressBar } from '../components/ProgressBar';

export default function Analytics() {
  const allItems = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const kpi = useStore((s) => s.kpi);

  const [period, setPeriod] = useState(() => lastNDaysRange(30));
  const [category, setCategory] = useState('all');
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'paused' | 'archived'>('all');

  // Items с пересчётом расхода за период.
  // Если v2 дал точные per-item spend — используем их.
  // Иначе CPx-аванс распределяется пропорционально просмотрам.
  const itemsForPeriod = useMemo(
    () =>
      itemsInDateRange(
        allItems,
        metrics,
        period.from,
        period.to,
        accountCharges,
        hasPerItemSpend
      ),
    [allItems, metrics, period.from, period.to, accountCharges, hasPerItemSpend]
  );

  const categoriesList = useMemo(
    () => Array.from(new Set(itemsForPeriod.map((i) => i.category))).sort(),
    [itemsForPeriod]
  );
  const regionsList = useMemo(
    () => Array.from(new Set(itemsForPeriod.map((i) => i.region))).sort(),
    [itemsForPeriod]
  );

  const filteredItems = itemsForPeriod.filter((i) => {
    if (category !== 'all' && i.category !== category) return false;
    if (region !== 'all' && i.region !== region) return false;
    if (status !== 'all' && i.status !== status) return false;
    return true;
  });

  // Метрики за выбранный период по выбранным items.
  // Расход в metrics — только per-item VAS из operations (без распределённого CPx),
  // поэтому к series.spend добавляем долю CPx-пула этого дня пропорционально views.
  const filteredMetrics = useMemo(
    () =>
      metrics.filter(
        (m) =>
          filteredItems.some((it) => String(it.id) === String(m.itemId)) &&
          m.date >= period.from &&
          m.date <= period.to
      ),
    [metrics, filteredItems, period.from, period.to]
  );
  const cpxByDate = useMemo(() => {
    // Сумма CPx-пополнений по дням за период.
    // Если v2 уже дал точный per-item spend — оставляем 0 (не двойной учёт).
    if (hasPerItemSpend) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const c of accountCharges) {
      if (c.date < period.from || c.date > period.to) continue;
      if (c.kind !== 'promotion_pool' && c.kind !== 'refund') continue;
      m.set(c.date, (m.get(c.date) ?? 0) + c.amount);
    }
    return m;
  }, [accountCharges, period.from, period.to, hasPerItemSpend]);
  const series = useMemo(() => {
    const baseSeries = aggregateMetricsByDate(filteredMetrics);
    // Добавляем к расходу за день распределённый CPx-пул того же дня (если есть)
    return baseSeries.map((d) => {
      const cpxThisDay = cpxByDate.get(d.date) ?? 0;
      return {
        ...d,
        spend: Math.round(d.spend + cpxThisDay),
      };
    });
  }, [filteredMetrics, cpxByDate]);

  const stats = calculateAccountStats(filteredItems, kpi);

  const catAvg = categoryAverages(filteredItems);
  const catData = Array.from(catAvg.entries()).map(([name, v]) => ({
    name,
    spend: v.spend,
    cpl: v.cpl ?? 0,
    conversion: v.conversion ?? 0,
  }));
  const regData = regionAverages(filteredItems).sort((a, b) => b.spend - a.spend);
  const ineffectiveCities = useMemo(
    () =>
      regData
        .map((r) => ({
          ...r,
          overspend:
            r.cpl != null && r.cpl > kpi.targetCpl ? r.cpl - kpi.targetCpl : 0,
        }))
        .filter((r) => r.overspend > 0)
        .sort((a, b) => b.spend - a.spend),
    [regData, kpi.targetCpl]
  );

  const top = [...filteredItems]
    .filter((i) => i.contacts > 0)
    .sort((a, b) => (calcCpl(a.spend, a.contacts) ?? 0) - (calcCpl(b.spend, b.contacts) ?? 0))
    .slice(0, 5);
  const bottom = [...filteredItems]
    .filter((i) => i.spend > 0)
    .sort((a, b) => (calcCpl(b.spend, b.contacts) ?? 0) - (calcCpl(a.spend, a.contacts) ?? 0))
    .slice(0, 5);

  return (
    <Layout
      title="Аналитика"
      subtitle="Графики и сравнение по объявлениям, категориям и регионам"
    >
      <div className="card p-3 sm:p-4 mb-4">
        <PeriodPicker value={period} onChange={setPeriod} className="mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">Все категории</option>
            {categoriesList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">Все города</option>
            {regionsList.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">Любой статус</option>
            <option value="active">Активные</option>
            <option value="paused">Приостановленные</option>
            <option value="archived">В архиве</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card title="Расход по дням">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatRub(v)} />
              <Bar dataKey="spend" fill="#FF6A00" name="Расход, ₽" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Просмотры и контакты по дням">
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
        </Card>
        <Card title="CPL по дням">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="cpl" stroke="#f87171" name="CPL, ₽" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Конверсия по дням, %">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="conversion" stroke="#34d399" name="CR, %" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card title="Выполнение KPI">
          <KpiBar label="Лиды" value={stats.leadsProgress} note={`${formatNumber(stats.totalContacts)} / ${formatNumber(kpi.targetLeads)}`} />
          <KpiBar
            label="CPL"
            value={stats.cplProgress ?? 0}
            note={
              stats.averageCpl != null
                ? `${formatRub(stats.averageCpl)} → цель ${formatRub(kpi.targetCpl)}`
                : 'Нет данных'
            }
          />
          <KpiBar
            label="Конверсия"
            value={stats.conversionProgress ?? 0}
            note={
              stats.averageConversion != null
                ? `${formatPercent(stats.averageConversion)} → цель ${formatPercent(kpi.targetConversionRate)}`
                : 'Нет данных'
            }
          />
          <KpiBar label="Бюджет" value={stats.budgetUsage} note={`${formatRub(stats.totalSpend)} / ${formatRub(kpi.monthlyBudget)}`} />
        </Card>
        <Card title="Неэффективные города">
          {ineffectiveCities.length === 0 ? (
            <div className="text-sm text-ink-400">
              За выбранный период городов с CPL выше целевого нет — все в норме.
            </div>
          ) : (
            <div className="space-y-2">
              {ineffectiveCities.map((c) => (
                <div
                  key={c.region}
                  className="flex items-center justify-between border border-rose-500/30 bg-rose-500/5 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {c.region}
                    </div>
                    <div className="text-xs text-ink-400">
                      {formatNumber(c.contacts)} лидов · {formatRub(c.spend)}
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0 ml-3">
                    <div className="font-semibold text-rose-300">
                      {c.cpl != null ? formatRub(c.cpl) : '—'}
                    </div>
                    <div className="text-ink-400">
                      +{formatRub(c.overspend)} от целевого
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Эффективность по городам">
          <div className="space-y-2">
            {regData.slice(0, 8).map((r) => {
              const isOverspend = r.cpl != null && r.cpl > kpi.targetCpl;
              const isGood = r.cpl != null && r.cpl <= kpi.targetCpl && r.contacts > 0;
              return (
                <div
                  key={r.region}
                  className={[
                    'flex items-center justify-between border rounded-lg px-3 py-2',
                    isOverspend
                      ? 'border-rose-500/30 bg-rose-500/5'
                      : isGood
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-ink-800',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {r.region}
                    </div>
                    <div className="text-xs text-ink-400">
                      {formatNumber(r.contacts)} лидов · {formatRub(r.spend)}
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0 ml-3">
                    <div
                      className={`font-semibold ${
                        isOverspend
                          ? 'text-rose-300'
                          : isGood
                          ? 'text-emerald-300'
                          : 'text-white'
                      }`}
                    >
                      {r.cpl != null ? formatRub(r.cpl) : '—'}
                    </div>
                    <div className="text-ink-400">
                      {r.conversion != null ? formatPercent(r.conversion) : '—'}
                    </div>
                  </div>
                </div>
              );
            })}
            {regData.filter((r) => r.cpl != null && r.cpl > kpi.targetCpl).length === 0 && (
              <div className="text-xs text-ink-400 mt-2">
                Перерасхода ни в одном городе не выявлено.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card title="Эффективность по категориям">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={catData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262630" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="cpl" fill="#60a5fa" name="CPL, ₽" />
              <Bar dataKey="conversion" fill="#34d399" name="CR, %" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Лидеры и аутсайдеры">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-emerald-300 font-semibold mb-2">
                Лидеры
              </div>
              <ul className="space-y-1.5">
                {top.map((it) => (
                  <li key={it.id} className="text-sm flex items-center justify-between">
                    <span className="truncate">{it.title}</span>
                    <span className="text-xs text-emerald-300">
                      {formatRub(calcCpl(it.spend, it.contacts) ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-rose-300 font-semibold mb-2">
                Аутсайдеры
              </div>
              <ul className="space-y-1.5">
                {bottom.map((it) => (
                  <li key={it.id} className="text-sm flex items-center justify-between">
                    <span className="truncate">{it.title}</span>
                    <span className="text-xs text-rose-300">
                      {it.contacts > 0
                        ? formatRub(calcCpl(it.spend, it.contacts) ?? 0)
                        : 'нет лидов'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function KpiBar({ label, value, note }: { label: string; value: number; note: string }) {
  const tone = value >= 95 ? 'green' : value >= 70 ? 'blue' : 'amber';
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm mb-1.5">
        <div className="text-ink-300">{label}</div>
        <div className="text-white font-medium">{note}</div>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}
