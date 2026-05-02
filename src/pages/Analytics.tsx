import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layout } from '../components/Layout';
import { useStore } from '../store/useStore';
import {
  aggregateMetricsByDate,
  calcCpl,
  calculateAccountStats,
  categoryAverages,
  formatNumber,
  formatPercent,
  formatRub,
  regionAverages,
} from '../lib/analytics';
import { ProgressBar } from '../components/ProgressBar';

const palette = [
  '#FF6A00',
  '#FF9447',
  '#60a5fa',
  '#34d399',
  '#f59e0b',
  '#f87171',
  '#a78bfa',
  '#22d3ee',
];

export default function Analytics() {
  const items = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const kpi = useStore((s) => s.kpi);

  const [period, setPeriod] = useState<'7' | '14' | '30'>('30');
  const [category, setCategory] = useState('all');
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const [source, setSource] = useState<'all' | 'demo' | 'api' | 'csv'>('all');

  const categoriesList = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items]
  );
  const regionsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.region))).sort(),
    [items]
  );

  const filteredItems = items.filter((i) => {
    if (category !== 'all' && i.category !== category) return false;
    if (region !== 'all' && i.region !== region) return false;
    if (status !== 'all' && i.status !== status) return false;
    return true;
  });

  const days = +period;
  const lastN = (date: string) => {
    const d = new Date(date).getTime();
    const start = new Date('2026-05-01').getTime() - days * 86400000;
    return d >= start;
  };
  const filteredMetrics = metrics.filter(
    (m) => filteredItems.some((it) => it.id === m.itemId) && lastN(m.date)
  );
  const series = aggregateMetricsByDate(filteredMetrics);

  const stats = calculateAccountStats(filteredItems, kpi);

  const catAvg = categoryAverages(filteredItems);
  const catData = Array.from(catAvg.entries()).map(([name, v]) => ({
    name,
    spend: v.spend,
    cpl: v.cpl ?? 0,
    conversion: v.conversion ?? 0,
  }));
  const regData = regionAverages(filteredItems).sort((a, b) => b.spend - a.spend);

  const budgetDistribution = catData.map((d, i) => ({
    name: d.name,
    value: d.spend,
    fill: palette[i % palette.length],
  }));

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
      <div className="card p-3 sm:p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as '7' | '14' | '30')}>
          <option value="7">7 дней</option>
          <option value="14">14 дней</option>
          <option value="30">30 дней</option>
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">Все категории</option>
          {categoriesList.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="all">Все регионы</option>
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
        <select className="input" defaultValue="товары">
          <option value="товары">Тип: товары</option>
          <option value="услуги">Тип: услуги</option>
        </select>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="all">Все источники</option>
          <option value="demo">Demo</option>
          <option value="api">API</option>
          <option value="csv">CSV</option>
        </select>
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
        <Card title="Распределение бюджета по категориям">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={budgetDistribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                {budgetDistribution.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatRub(v)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Эффективность по регионам">
          <div className="space-y-2">
            {regData.slice(0, 7).map((r) => (
              <div
                key={r.region}
                className="flex items-center justify-between border-b border-ink-800 pb-2 last:border-0 last:pb-0"
              >
                <div>
                  <div className="text-sm font-medium text-white">{r.region}</div>
                  <div className="text-xs text-ink-400">
                    {formatNumber(r.contacts)} лидов · {formatRub(r.spend)}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-medium text-white">
                    {r.cpl != null ? formatRub(r.cpl) : '—'}
                  </div>
                  <div className="text-ink-400">
                    {r.conversion != null ? formatPercent(r.conversion) : '—'}
                  </div>
                </div>
              </div>
            ))}
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
