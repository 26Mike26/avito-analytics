import { useEffect, useMemo, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
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
  calcCtr,
  calculateAccountStats,
  categoryAverages,
  formatNumber,
  formatPercent,
  formatRub,
  itemsInDateRange,
  regionAverages,
  scaleKpiForPeriod,
  subcategoryName,
} from '../lib/analytics';
import { ProgressBar } from '../components/ProgressBar';
import { repository } from '../services/Repository';

function loadPreciseCityCache(key: string): Map<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(
      Object.entries(parsed).filter(([, value]) => Number.isFinite(Number(value)))
    );
  } catch {
    return new Map();
  }
}

function savePreciseCityCache(key: string, values: Map<string, number>) {
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(values)));
}

export default function Analytics() {
  const allItems = useStore((s) => s.items);
  const metrics = useStore((s) => s.metrics);
  const accountCharges = useStore((s) => s.accountCharges);
  const hasPerItemSpend = useStore((s) => s.hasPerItemSpend);
  const spendings = useStore((s) => s.spendings);
  const kpi = useStore((s) => s.kpi);
  const currentAccountId = useStore((s) => s.currentAccountId);
  const period = useStore((s) => s.analyticsPeriod);
  const setPeriod = useStore((s) => s.setAnalyticsPeriod);
  const periodKpi = useMemo(
    () => scaleKpiForPeriod(kpi, period.from, period.to),
    [kpi, period.from, period.to]
  );

  const [category, setCategory] = useState('all');
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const adapter = useStore((s) => s.adapter);

  // Точный расход по городам (через /stats/v2/spendings filter.itemIds).
  // Map<city, total> — сохраняется в кеше, чтобы не сбрасываться при навигации.
  const preciseCityCacheKey = useMemo(
    () =>
      `avito-precise-city:${currentAccountId ?? 'demo'}:${period.from}:${period.to}:${category}:${region}:${status}`,
    [currentAccountId, period.from, period.to, category, region, status]
  );
  const [preciseCity, setPreciseCity] = useState<Map<string, number>>(new Map());
  const [preciseProgress, setPreciseProgress] = useState<{
    busy: boolean;
    done: number;
    total: number;
    nextEta?: number;
  }>({ busy: false, done: 0, total: 0 });

  useEffect(() => {
    setPreciseCity(loadPreciseCityCache(preciseCityCacheKey));
    setPreciseProgress({ busy: false, done: 0, total: 0 });
  }, [preciseCityCacheKey]);

  const adsTotalFromSpendings = useMemo(() => {
    if (!spendings) return null;
    const inRange = spendings.byDate.filter(
      (d) => d.date >= period.from && d.date <= period.to
    );
    return inRange.reduce((s, d) => s + d.ads, 0);
  }, [spendings, period.from, period.to]);
  const otherTotalInPeriod = useMemo(() => {
    if (spendings) {
      const inRange = spendings.byDate.filter(
        (d) => d.date >= period.from && d.date <= period.to
      );
      return inRange.reduce((s, d) => s + Math.max(0, d.total - d.ads), 0);
    }
    return accountCharges
      .filter((c) => c.date >= period.from && c.date <= period.to)
      .filter((c) => c.kind === 'account_other')
      .reduce((s, c) => s + c.amount, 0);
  }, [spendings, accountCharges, period.from, period.to]);

  // Items с пересчётом расхода за период.
  // Приоритет: точное ads из spendings → распределение CPx → 0.
  // Комиссии/прочее тоже распределяем по объявлениям, чтобы CPL был полным.
  const itemsForPeriod = useMemo(
    () =>
      itemsInDateRange(
        allItems,
        metrics,
        period.from,
        period.to,
        accountCharges,
        hasPerItemSpend,
        adsTotalFromSpendings,
        otherTotalInPeriod
      ),
    [
      allItems,
      metrics,
      period.from,
      period.to,
      accountCharges,
      hasPerItemSpend,
      adsTotalFromSpendings,
      otherTotalInPeriod,
    ]
  );

  const categoriesList = useMemo(
    () => Array.from(new Set(itemsForPeriod.map((i) => subcategoryName(i.category)))).sort(),
    [itemsForPeriod]
  );
  const regionsList = useMemo(
    () => Array.from(new Set(itemsForPeriod.map((i) => i.region))).sort(),
    [itemsForPeriod]
  );

  const filteredItems = useMemo(
    () =>
      itemsForPeriod.filter((i) => {
        if (category !== 'all' && subcategoryName(i.category) !== category) return false;
        if (region !== 'all' && i.region !== region) return false;
        if (status !== 'all' && i.status !== status) return false;
        return true;
      }),
    [itemsForPeriod, category, region, status]
  );

  useEffect(() => {
    if (!currentAccountId || filteredItems.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const rows = await repository.loadItemDailyStats(
          currentAccountId,
          period.from,
          period.to
        );
        if (cancelled) return;

        const exactRows = rows.filter((row) => row.accuracy === 'exact');
        if (exactRows.length === 0) return;

        const exactSpendByItem = new Map<string, number>();
        for (const row of exactRows) {
          const key = String(row.itemId);
          exactSpendByItem.set(
            key,
            (exactSpendByItem.get(key) ?? 0) + Number(row.spend ?? 0)
          );
        }

        const idsByCity = new Map<string, string[]>();
        for (const item of filteredItems) {
          if (!itemHasPeriodData(item)) continue;
          const key = String(item.id);
          idsByCity.set(item.region, [...(idsByCity.get(item.region) ?? []), key]);
        }

        const exactCitySpend = new Map<string, number>();
        for (const [city, ids] of idsByCity.entries()) {
          if (ids.length === 0 || !ids.every((id) => exactSpendByItem.has(id))) continue;
          exactCitySpend.set(
            city,
            ids.reduce((sum, id) => sum + (exactSpendByItem.get(id) ?? 0), 0)
          );
        }
        if (exactCitySpend.size === 0) return;

        setPreciseCity((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [city, spend] of exactCitySpend.entries()) {
            const rounded = Math.round(spend);
            if (next.get(city) !== rounded) {
              next.set(city, rounded);
              changed = true;
            }
          }
          if (!changed) return prev;
          savePreciseCityCache(preciseCityCacheKey, next);
          return next;
        });
      } catch (e) {
        console.warn('[stats-cache] restore analytics precise city spend:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentAccountId,
    filteredItems,
    period.from,
    period.to,
    preciseCityCacheKey,
  ]);

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
  // Сумма ads-расхода (promotion+presence) по дням, **с учётом фильтров city/category**.
  // Логика: общий adsByDate из spendings нормализуем по доле просмотров
  // отфильтрованных items от всех items в этот день.
  // Так график расхода и CPL по дням реагируют на смену города/категории.
  const allMetricsInPeriod = useMemo(
    () => metrics.filter((m) => m.date >= period.from && m.date <= period.to),
    [metrics, period.from, period.to]
  );
  const adsByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (hasPerItemSpend) return m; // metrics уже содержат точный spend
    // Считаем доли: views_filtered_day / views_all_day
    const filteredViewsByDate = new Map<string, number>();
    const allViewsByDate = new Map<string, number>();
    for (const x of filteredMetrics) {
      filteredViewsByDate.set(x.date, (filteredViewsByDate.get(x.date) ?? 0) + x.views);
    }
    for (const x of allMetricsInPeriod) {
      allViewsByDate.set(x.date, (allViewsByDate.get(x.date) ?? 0) + x.views);
    }
    if (spendings) {
      for (const d of spendings.byDate) {
        if (d.date < period.from || d.date > period.to) continue;
        const allViews = allViewsByDate.get(d.date) ?? 0;
        const filteredViews = filteredViewsByDate.get(d.date) ?? 0;
        if (allViews === 0) {
          m.set(d.date, 0);
        } else {
          m.set(d.date, (filteredViews / allViews) * d.ads);
        }
      }
      return m;
    }
    // Fallback: CPx-пополнения из operations (тоже нормализуем по фильтру)
    for (const c of accountCharges) {
      if (c.date < period.from || c.date > period.to) continue;
      if (c.kind !== 'promotion_pool' && c.kind !== 'refund') continue;
      const allViews = allViewsByDate.get(c.date) ?? 0;
      const filteredViews = filteredViewsByDate.get(c.date) ?? 0;
      const share = allViews > 0 ? filteredViews / allViews : 1;
      m.set(c.date, (m.get(c.date) ?? 0) + c.amount * share);
    }
    return m;
  }, [
    accountCharges,
    period.from,
    period.to,
    hasPerItemSpend,
    spendings,
    filteredMetrics,
    allMetricsInPeriod,
  ]);
  const otherByDate = useMemo(() => {
    const m = new Map<string, number>();
    const filteredViewsByDate = new Map<string, number>();
    const allViewsByDate = new Map<string, number>();
    for (const x of filteredMetrics) {
      filteredViewsByDate.set(x.date, (filteredViewsByDate.get(x.date) ?? 0) + x.views);
    }
    for (const x of allMetricsInPeriod) {
      allViewsByDate.set(x.date, (allViewsByDate.get(x.date) ?? 0) + x.views);
    }
    if (spendings) {
      for (const d of spendings.byDate) {
        if (d.date < period.from || d.date > period.to) continue;
        const other = Math.max(0, d.total - d.ads);
        const allViews = allViewsByDate.get(d.date) ?? 0;
        const filteredViews = filteredViewsByDate.get(d.date) ?? 0;
        m.set(d.date, allViews > 0 ? (filteredViews / allViews) * other : 0);
      }
      return m;
    }
    for (const c of accountCharges) {
      if (c.date < period.from || c.date > period.to) continue;
      if (c.kind !== 'account_other') continue;
      const allViews = allViewsByDate.get(c.date) ?? 0;
      const filteredViews = filteredViewsByDate.get(c.date) ?? 0;
      const share = allViews > 0 ? filteredViews / allViews : 1;
      m.set(c.date, (m.get(c.date) ?? 0) + c.amount * share);
    }
    return m;
  }, [
    accountCharges,
    period.from,
    period.to,
    spendings,
    filteredMetrics,
    allMetricsInPeriod,
  ]);
  const series = useMemo(() => {
    const baseSeries = aggregateMetricsByDate(filteredMetrics);
    const byDate = new Map(baseSeries.map((d) => [d.date, d]));
    for (const date of new Set([...adsByDate.keys(), ...otherByDate.keys()])) {
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          views: 0,
          contacts: 0,
          spend: 0,
          favorites: 0,
          cpl: 0,
          conversion: 0,
        });
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
      const adsThisDay = adsByDate.get(d.date) ?? 0;
      const otherThisDay = otherByDate.get(d.date) ?? 0;
      // Если у нас точный spendings — отбрасываем VAS из metrics (двойной учёт).
      // Иначе (fallback) — суммируем VAS из metrics + распределённый CPx.
      const totalSpend = (spendings ? adsThisDay : d.spend + adsThisDay) + otherThisDay;
      const cpl = d.contacts > 0 ? Math.round(totalSpend / d.contacts) : 0;
      return {
        ...d,
        spend: Math.round(totalSpend),
        cpl,
      };
    });
  }, [filteredMetrics, adsByDate, otherByDate, spendings]);

  const stats = calculateAccountStats(filteredItems, periodKpi);

  const catAvg = categoryAverages(filteredItems);
  const catData = Array.from(catAvg.entries()).map(([name, v]) => ({
    name,
    spend: v.spend,
    cpl: v.cpl ?? 0,
    conversion: v.conversion ?? 0,
  }));
  const regData = regionAverages(filteredItems).sort((a, b) => b.spend - a.spend);
  /**
   * Запускает точный расчёт расхода по всем городам через filter.itemIds.
   * Avito rate limit /stats/v2/spendings = 1 запрос/мин, поэтому последовательно
   * с задержкой 65 сек между городами.
   */
  const runPreciseCityCalc = async () => {
    if (preciseProgress.busy) return;
    const targets = [...regData]
      .filter((r) => !preciseCity.has(r.region))
      .sort((a, b) => b.spend - a.spend);
    const total = targets.length;
    if (total === 0) return;
    setPreciseProgress({ busy: true, done: 0, total });
    const newMap = new Map(preciseCity);
    for (let i = 0; i < targets.length; i++) {
      const city = targets[i];
      // Собираем itemIds, которые в этом городе
      const itemIdsForCity = filteredItems
        .filter((it) => it.region === city.region)
        .map((it) => Number(it.id))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (itemIdsForCity.length === 0) {
        setPreciseProgress((p) => ({ ...p, done: i + 1 }));
        continue;
      }
      const r = await adapter.fetchAdsForItems({
        dateFrom: period.from,
        dateTo: period.to,
        itemIds: itemIdsForCity,
      });
      if (r) newMap.set(city.region, Math.round(r.total));
      const snapshot = new Map(newMap);
      setPreciseCity(snapshot);
      savePreciseCityCache(preciseCityCacheKey, snapshot);
      setPreciseProgress({ busy: true, done: i + 1, total });
      // Между запросами задержка 65 сек (rate limit 1/мин), кроме последнего
      if (i < targets.length - 1) {
        const eta = Date.now() + 65_000;
        setPreciseProgress((p) => ({ ...p, nextEta: eta }));
        await new Promise((res) => setTimeout(res, 65_000));
      }
    }
    setPreciseProgress({ busy: false, done: total, total });
  };

  // Применяем точные значения к regData (если они есть для города)
  const regDataPrecise = useMemo(
    () =>
      regData.map((r) => {
        const precise = preciseCity.get(r.region);
        if (precise == null) return r;
        return {
          ...r,
          spend: Math.round(precise),
          cpl: r.contacts > 0 ? Math.round(precise / r.contacts) : null,
        };
      }),
    [regData, preciseCity]
  );

  const ineffectiveCities = useMemo(
    () =>
      regDataPrecise
        .map((r) => ({
          ...r,
          overspend:
            r.cpl != null && r.cpl > kpi.targetCpl ? r.cpl - kpi.targetCpl : 0,
          // Помечаем тип проблемы для UI
          reason: (r.cpl != null && r.cpl > kpi.targetCpl
            ? 'overspend'
            : r.contacts === 0 && r.spend > 0
            ? 'no-leads'
            : null) as 'overspend' | 'no-leads' | null,
        }))
        // Неэффективные = CPL выше цели ИЛИ расход есть, а лидов нет
        .filter((r) => r.reason !== null)
        // Сортировка: сначала «тратили без лидов», потом по абсолютному расходу
        .sort((a, b) => {
          if (a.reason === 'no-leads' && b.reason !== 'no-leads') return -1;
          if (b.reason === 'no-leads' && a.reason !== 'no-leads') return 1;
          return b.spend - a.spend;
        }),
    [regDataPrecise, kpi.targetCpl]
  );
  const effectiveCities = useMemo(
    () =>
      regDataPrecise
        // Только те, где CPL ≤ цели — выполняют KPI по цене лида
        .filter((r) => r.cpl != null && r.cpl <= kpi.targetCpl && r.contacts > 0)
        .sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0)),
    [regDataPrecise, kpi.targetCpl]
  );

  const top = [...filteredItems]
    .filter((i) => {
      const cpl = calcCpl(i.spend, i.contacts);
      return i.spend > 0 && cpl != null && cpl <= kpi.targetCpl;
    })
    .sort((a, b) => (calcCpl(a.spend, a.contacts) ?? 0) - (calcCpl(b.spend, b.contacts) ?? 0))
    .slice(0, 5);
  const topItemIds = new Set(top.map((i) => String(i.id)));
  const bottom = [...filteredItems]
    .filter((i) => {
      if (i.spend <= 0 || topItemIds.has(String(i.id))) return false;
      const cpl = calcCpl(i.spend, i.contacts);
      return cpl == null || cpl > kpi.targetCpl;
    })
    .sort((a, b) => {
      const aCpl = calcCpl(a.spend, a.contacts);
      const bCpl = calcCpl(b.spend, b.contacts);
      if (aCpl == null && bCpl != null) return -1;
      if (bCpl == null && aCpl != null) return 1;
      return (bCpl ?? 0) - (aCpl ?? 0);
    })
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
            <option value="all">Все подкатегории</option>
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
          <KpiBar label="Лиды" value={stats.leadsProgress} note={`${formatNumber(stats.totalContacts)} / ${formatNumber(periodKpi.targetLeads)}`} />
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
          <KpiBar label="Бюджет периода" value={stats.budgetUsage} note={`${formatRub(stats.totalSpend)} / ${formatRub(periodKpi.monthlyBudget)}`} />
        </Card>
        <Card title="Неэффективные города (CPL выше цели)">
          <PreciseCalcBar
            preciseCount={preciseCity.size}
            progress={preciseProgress}
            onRun={runPreciseCityCalc}
          />
          {ineffectiveCities.length === 0 ? (
            <div className="text-sm text-ink-400">
              За выбранный период городов с CPL выше целевого нет — все в норме.
            </div>
          ) : (
            <div className="space-y-2">
              {ineffectiveCities.map((c) => (
                <CityRow
                  key={c.region}
                  city={c}
                  tone="bad"
                  precise={preciseCity.has(c.region)}
                />
              ))}
            </div>
          )}
        </Card>
        <Card title="Эффективные города (CPL в пределах цели)">
          {effectiveCities.length === 0 ? (
            <div className="text-sm text-ink-400">
              За период нет городов, выполняющих KPI по цене лида.
            </div>
          ) : (
            <div className="space-y-2">
              {effectiveCities.map((c) => (
                <CityRow
                  key={c.region}
                  city={c}
                  tone="good"
                  precise={preciseCity.has(c.region)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card title="Эффективность по подкатегориям">
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
                {top.map((it) => {
                  const cpl = calcCpl(it.spend, it.contacts);
                  const ctr = calcCtr(it.views, it.impressions);
                  return (
                    <li key={it.id} className="text-sm flex items-center justify-between gap-3">
                      <span className="truncate">{it.title}</span>
                      <span className="text-xs text-emerald-300 shrink-0 text-right">
                        {formatNumber(it.contacts)} лидов · {cpl != null ? formatRub(cpl) : 'CPL —'} · CTR {ctr != null ? formatPercent(ctr) : '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-rose-300 font-semibold mb-2">
                Аутсайдеры
              </div>
              <ul className="space-y-1.5">
                {bottom.map((it) => {
                  const cpl = calcCpl(it.spend, it.contacts);
                  const ctr = calcCtr(it.views, it.impressions);
                  return (
                    <li key={it.id} className="text-sm flex items-center justify-between gap-3">
                      <span className="truncate">{it.title}</span>
                      <span className="text-xs text-rose-300 shrink-0 text-right">
                        {formatNumber(it.contacts)} лидов · {cpl != null ? formatRub(cpl) : 'нет лидов'} · CTR {ctr != null ? formatPercent(ctr) : '—'}
                      </span>
                    </li>
                  );
                })}
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

function CityRow({
  city,
  tone,
  precise = false,
}: {
  city: {
    region: string;
    cpl: number | null;
    conversion: number | null;
    ctr: number | null;
    spend: number;
    contacts: number;
    views: number;
    favorites: number;
    reason?: 'overspend' | 'no-leads' | null;
  };
  tone: 'good' | 'bad';
  precise?: boolean;
}) {
  const isNoLeads = city.reason === 'no-leads';
  const colorWrap =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : 'border-rose-500/30 bg-rose-500/5';
  const cplColor = tone === 'good' ? 'text-emerald-300' : 'text-rose-300';
  return (
    <div
      className={`flex items-center justify-between border rounded-lg px-3 py-2 ${colorWrap}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">
          {city.region}
          {precise && (
            <span
              title="Точные данные из Avito Pro"
              className="ml-2 text-[10px] uppercase tracking-wider text-emerald-300 font-bold"
            >
              ✓ точно
            </span>
          )}
          {isNoLeads && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-rose-300 font-bold">
              ⚠ нет лидов
            </span>
          )}
        </div>
        <div className="text-xs text-ink-400">
          {formatNumber(city.contacts)} лидов · {formatNumber(city.views)} просм. ·{' '}
          {formatRub(city.spend)}
        </div>
      </div>
      <div className="text-right text-xs shrink-0 ml-3 space-y-0.5">
        <div className={`font-semibold ${cplColor}`}>
          {isNoLeads
            ? `Слив ${formatRub(city.spend)}`
            : `CPL ${city.cpl != null ? formatRub(city.cpl) : '—'}`}
        </div>
        <div className="text-ink-300">
          CR {city.conversion != null ? formatPercent(city.conversion) : '—'}
        </div>
        <div className="text-ink-400">
          CTR {city.ctr != null ? formatPercent(city.ctr) : '—'}
        </div>
      </div>
    </div>
  );
}

function itemHasPeriodData(item: {
  views?: number;
  impressions?: number;
  contacts?: number;
  favorites?: number;
  spend?: number;
}) {
  return (
    Number(item.views ?? 0) > 0 ||
    Number(item.impressions ?? 0) > 0 ||
    Number(item.contacts ?? 0) > 0 ||
    Number(item.favorites ?? 0) > 0 ||
    Number(item.spend ?? 0) > 0
  );
}

/**
 * Кнопка-баннер запуска точного расчёта расхода по городам.
 * Avito rate limit /stats/v2/spendings = 1 запрос/мин, поэтому процесс
 * идёт последовательно по всем городам без уже уточнённых.
 */
function PreciseCalcBar({
  preciseCount,
  progress,
  onRun,
}: {
  preciseCount: number;
  progress: { busy: boolean; done: number; total: number; nextEta?: number };
  onRun: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  // Тикаем раз в секунду — для отображения «осталось N сек до следующего запроса»
  useEffect(() => {
    if (!progress.busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.busy]);
  const secLeft = progress.nextEta ? Math.max(0, Math.round((progress.nextEta - now) / 1000)) : 0;
  return (
    <div className="mb-3 -mt-1 flex flex-wrap items-center gap-2 text-xs">
      <button
        onClick={onRun}
        disabled={progress.busy}
        className="btn-secondary !px-3 !py-1.5 !min-h-0 disabled:opacity-50"
        title="Точный расход через Avito API (filter.itemIds). 1 запрос/мин, города уточняются последовательно."
      >
        {progress.busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Wand2 className="w-3.5 h-3.5" />
        )}
        {progress.busy
          ? `Уточняю ${progress.done}/${progress.total}${secLeft > 0 ? ` · ${secLeft} c` : ''}`
          : preciseCount > 0
          ? `Уточнить ещё (точных городов: ${preciseCount})`
          : 'Уточнить данные'}
      </button>
      {!progress.busy && preciseCount === 0 && (
        <span className="text-ink-400">
          Текущие суммы — приближение. Кнопка последовательно уточнит все города в Avito.
        </span>
      )}
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
