import type { AccountKpi, AvitoItem, ItemMetrics } from '../types';

export const formatRub = (value: number): string =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU').format(Math.round(value));

export const formatPercent = (value: number, digits = 1): string =>
  `${value.toFixed(digits).replace('.', ',')}%`;

export function calcCpl(spend: number, contacts: number): number | null {
  if (!contacts || contacts <= 0) return null;
  return spend / contacts;
}

export function calcConversion(views: number, contacts: number): number | null {
  if (!views || views <= 0) return null;
  return (contacts / views) * 100;
}

export function calcRoi(revenue: number | undefined, spend: number): number | null {
  if (!spend || revenue === undefined) return null;
  return ((revenue - spend) / spend) * 100;
}

export function calcRoas(revenue: number | undefined, spend: number): number | null {
  if (!spend || revenue === undefined) return null;
  return revenue / spend;
}

export function calcBudgetUsage(spend: number, planned: number): number {
  if (!planned) return 0;
  return (spend / planned) * 100;
}

export function calcKpiProgress(current: number, target: number): number {
  if (!target) return 0;
  return (current / target) * 100;
}

export type AccountStats = {
  totalSpend: number;
  totalViews: number;
  totalContacts: number;
  totalFavorites: number;
  totalRevenue: number;
  averageCpl: number | null;
  averageConversion: number | null;
  roi: number | null;
  roas: number | null;
  budgetUsage: number;
  leadsProgress: number;
  cplProgress: number | null;
  conversionProgress: number | null;
  roiProgress: number | null;
  warnings: string[];
};

export function calculateAccountStats(
  items: AvitoItem[],
  kpi: AccountKpi
): AccountStats {
  const totalSpend = items.reduce((s, i) => s + i.spend, 0);
  const totalViews = items.reduce((s, i) => s + i.views, 0);
  const totalContacts = items.reduce((s, i) => s + i.contacts, 0);
  const totalFavorites = items.reduce((s, i) => s + i.favorites, 0);
  const totalRevenue = items.reduce((s, i) => s + (i.revenue ?? 0), 0);

  const averageCpl = calcCpl(totalSpend, totalContacts);
  const averageConversion = calcConversion(totalViews, totalContacts);
  const roi = calcRoi(totalRevenue || undefined, totalSpend);
  const roas = calcRoas(totalRevenue || undefined, totalSpend);
  const budgetUsage = calcBudgetUsage(totalSpend, kpi.monthlyBudget);
  const leadsProgress = calcKpiProgress(totalContacts, kpi.targetLeads);
  const cplProgress =
    averageCpl != null ? (kpi.targetCpl / averageCpl) * 100 : null;
  const conversionProgress =
    averageConversion != null
      ? calcKpiProgress(averageConversion, kpi.targetConversionRate)
      : null;
  const roiProgress = roi != null ? calcKpiProgress(roi, kpi.targetRoi) : null;

  const warnings: string[] = [];
  if (averageCpl != null && averageCpl > kpi.targetCpl * (1 + kpi.allowedOverspend / 100)) {
    warnings.push(
      `Средний CPL ${formatRub(averageCpl)} превышает целевой ${formatRub(
        kpi.targetCpl
      )} с учётом допустимого перерасхода ${kpi.allowedOverspend}%.`
    );
  }
  if (budgetUsage > 100) {
    warnings.push(
      `Месячный бюджет израсходован на ${formatPercent(budgetUsage, 0)} — превышение ${formatRub(
        totalSpend - kpi.monthlyBudget
      )}.`
    );
  }
  if (averageConversion != null && averageConversion < kpi.targetConversionRate * 0.7) {
    warnings.push(
      `Конверсия ${formatPercent(averageConversion)} ниже целевой ${formatPercent(
        kpi.targetConversionRate
      )} более чем на 30%.`
    );
  }
  const itemsWithoutLeads = items.filter(
    (i) => i.status === 'active' && i.spend > 500 && i.contacts === 0
  ).length;
  if (itemsWithoutLeads > 0) {
    warnings.push(
      `${itemsWithoutLeads} активных объявлений тратят бюджет без обращений.`
    );
  }

  return {
    totalSpend,
    totalViews,
    totalContacts,
    totalFavorites,
    totalRevenue,
    averageCpl,
    averageConversion,
    roi,
    roas,
    budgetUsage,
    leadsProgress,
    cplProgress,
    conversionProgress,
    roiProgress,
    warnings,
  };
}

export type ItemEfficiency = 'effective' | 'overspend' | 'lowConversion' | 'noData' | 'noLeads' | 'average';

export function classifyItem(item: AvitoItem, kpi: AccountKpi): ItemEfficiency {
  const cpl = calcCpl(item.spend, item.contacts);
  const cr = calcConversion(item.views, item.contacts);
  const dataIsThin = item.views < 200 && item.spend < 1500;

  if (dataIsThin) return 'noData';
  if (item.spend > 1000 && item.contacts === 0) return 'noLeads';
  if (cpl != null && cpl > kpi.targetCpl * 1.4) return 'overspend';
  if (cr != null && cr < kpi.targetConversionRate * 0.6 && item.views > 1000)
    return 'lowConversion';
  if (cpl != null && cpl <= kpi.targetCpl) return 'effective';
  return 'average';
}

export function categoryAverages(items: AvitoItem[]) {
  const groups = new Map<string, { spend: number; contacts: number; views: number }>();
  for (const it of items) {
    const g = groups.get(it.category) ?? { spend: 0, contacts: 0, views: 0 };
    g.spend += it.spend;
    g.contacts += it.contacts;
    g.views += it.views;
    groups.set(it.category, g);
  }
  const out = new Map<string, { cpl: number | null; conversion: number | null; spend: number }>();
  for (const [k, v] of groups.entries()) {
    out.set(k, {
      cpl: calcCpl(v.spend, v.contacts),
      conversion: calcConversion(v.views, v.contacts),
      spend: v.spend,
    });
  }
  return out;
}

export function regionAverages(items: AvitoItem[]) {
  const groups = new Map<
    string,
    { spend: number; contacts: number; views: number; impressions: number; favorites: number }
  >();
  for (const it of items) {
    const g =
      groups.get(it.region) ?? { spend: 0, contacts: 0, views: 0, impressions: 0, favorites: 0 };
    g.spend += it.spend;
    g.contacts += it.contacts;
    g.views += it.views;
    g.impressions += it.impressions ?? 0;
    g.favorites += it.favorites;
    groups.set(it.region, g);
  }
  const out: Array<{
    region: string;
    cpl: number | null;
    /** Конверсия просмотр→контакт (CR), %. */
    conversion: number | null;
    /** CTR = просмотры / показы × 100 (классическая воронка показ → клик в карточку). */
    ctr: number | null;
    spend: number;
    contacts: number;
    views: number;
    impressions: number;
    favorites: number;
  }> = [];
  for (const [k, v] of groups.entries()) {
    out.push({
      region: k,
      cpl: calcCpl(v.spend, v.contacts),
      conversion: calcConversion(v.views, v.contacts),
      // CTR = views / impressions * 100 (Avito: uniqViews / views × 100).
      // Если impressions отсутствует — null.
      ctr:
        v.impressions > 0 ? +((v.views / v.impressions) * 100).toFixed(2) : null,
      spend: v.spend,
      contacts: v.contacts,
      views: v.views,
      impressions: v.impressions,
      favorites: v.favorites,
    });
  }
  return out;
}

/**
 * Пересчитывает items, подставляя суммы метрик за выбранный диапазон дат.
 * Используется и на дашборде, и в списке объявлений, чтобы фильтры по
 * периоду действительно влияли на показатели (а не только на подзаголовок).
 *
 * dateFrom/dateTo — в формате YYYY-MM-DD, включительно.
 * Если указан только dateFrom — берём с этой даты до сегодня.
 * Если ни тот, ни другой — возвращаем items как есть.
 */
/**
 * Нормализует адрес объявления: «Санкт-Петербург, ул. Ленина, 5» → «Санкт-Петербург».
 * Применяется на лету, чтобы старые items из localStorage тоже отображались
 * как чистые города (без улиц).
 */
function cleanCity(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '—';
  const first = s.split(',')[0].trim();
  return first.replace(/^г\.?\s*/i, '').trim() || '—';
}

/**
 * Тип записи о расходе аккаунта (промо-пул, рассылки, сторно).
 * Дублируем структуру из AvitoAdapter.AccountCharge, чтобы analytics не зависел
 * от services/.
 */
export type AccountChargeLite = {
  date: string;
  amount: number;
  kind?: 'promotion_pool' | 'account_other' | 'refund';
};

export function itemsInDateRange(
  items: AvitoItem[],
  metrics: ItemMetrics[],
  dateFrom?: string,
  dateTo?: string,
  accountCharges?: AccountChargeLite[],
  /**
   * Если true, расход в metrics уже per-item точный (например пришёл из /stats/v2)
   * — не распределяем CPx-аванс повторно по показам.
   */
  hasPerItemSpend = false,
  /**
   * Точная сумма расхода на рекламу за период из /stats/v2/spendings (ads = promotion+presence).
   * Если задано — распределяем именно её пропорционально показам, а не CPx-аванс из operations.
   * Это даёт точные per-item расходы согласованные с дашбордом.
   */
  adsTotalInPeriod?: number | null
): AvitoItem[] {
  // Сначала нормализуем регион (на случай старых данных в localStorage).
  const normalizedItems = items.map((it) => ({ ...it, region: cleanCity(it.region) }));
  if (!dateFrom && !dateTo) return normalizedItems;
  const from = dateFrom ?? '0000-01-01';
  const to = dateTo ?? '9999-12-31';
  const filtered = metrics.filter((m) => m.date >= from && m.date <= to);

  // ─── Пул, который распределяем по объявлениям пропорционально показам.
  // Приоритет источников (по точности):
  //   1. adsTotalInPeriod  — точное число из /stats/v2/spendings (ads = promotion+presence)
  //   2. CPx-аванс из operations_history (приближение)
  //   0. Если v2 уже дал per-item spend в самих metrics — пропускаем (флаг hasPerItemSpend)
  const cpxPoolInPeriod = hasPerItemSpend
    ? 0
    : adsTotalInPeriod != null && adsTotalInPeriod > 0
    ? adsTotalInPeriod
    : (accountCharges ?? [])
        .filter((c) => c.date >= from && c.date <= to)
        .filter((c) => c.kind === 'promotion_pool' || c.kind === 'refund')
        .reduce((s, c) => s + (c.amount || 0), 0);

  if (filtered.length === 0) {
    return normalizedItems.map((it) => ({
      ...it,
      views: 0,
      impressions: 0,
      contacts: 0,
      favorites: 0,
      spend: 0,
    }));
  }
  const sumByItem = new Map<
    string,
    { views: number; impressions: number; contacts: number; favorites: number; spend: number }
  >();
  for (const m of filtered) {
    const cur =
      sumByItem.get(m.itemId) ?? { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 };
    cur.views += m.views;
    cur.impressions += m.impressions ?? 0;
    cur.contacts += m.contacts;
    cur.favorites += m.favorites;
    cur.spend += m.spend;
    sumByItem.set(m.itemId, cur);
  }

  // Считаем общую сумму просмотров за период (для расчёта пропорции CPx)
  const totalViewsInPeriod = Array.from(sumByItem.values()).reduce(
    (s, v) => s + v.views,
    0
  );

  // ВАЖНО: если adsTotalInPeriod передан из /stats/v2/spendings — он уже
  // включает И promotion (VAS), И presence (CPx). Поэтому НЕ прибавляем
  // sum.spend (VAS из operations) — это даст двойной учёт.
  // Если же используется fallback на CPx-аванс из operations — там только
  // promotion-pool, и VAS из per-item operations отдельно — можно складывать.
  const useSpendingsSource = adsTotalInPeriod != null && adsTotalInPeriod > 0;

  return normalizedItems.map((it) => {
    const sum = sumByItem.get(it.id);
    if (!sum) {
      return { ...it, views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 };
    }
    // Распределяем общий пул пропорционально доле просмотров.
    const cpxShare =
      totalViewsInPeriod > 0 && cpxPoolInPeriod > 0
        ? (sum.views / totalViewsInPeriod) * cpxPoolInPeriod
        : 0;
    const itemSpend = useSpendingsSource ? cpxShare : sum.spend + cpxShare;
    return {
      ...it,
      views: sum.views,
      impressions: sum.impressions,
      contacts: sum.contacts,
      favorites: sum.favorites,
      spend: Math.round(itemSpend),
    };
  });
}

/**
 * Форматирует Date в YYYY-MM-DD по ЛОКАЛЬНОЙ таймзоне.
 * Это важно: toISOString() даёт UTC, и в МСК (+3) ночью «сегодня»
 * превращается в «вчера», ломая пресеты «Сегодня»/«Вчера».
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Возвращает диапазон дат «последние N дней включительно» в формате YYYY-MM-DD. */
export function lastNDaysRange(days: number, today = new Date()): { from: string; to: string } {
  const t = new Date(today);
  const from = new Date(t);
  from.setDate(t.getDate() - (days - 1));
  return { from: formatLocalDate(from), to: formatLocalDate(t) };
}

export function aggregateMetricsByDate(metrics: ItemMetrics[]) {
  const map = new Map<string, { date: string; views: number; contacts: number; spend: number; favorites: number }>();
  for (const m of metrics) {
    const cur = map.get(m.date) ?? {
      date: m.date,
      views: 0,
      contacts: 0,
      spend: 0,
      favorites: 0,
    };
    cur.views += m.views;
    cur.contacts += m.contacts;
    cur.spend += m.spend;
    cur.favorites += m.favorites;
    map.set(m.date, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      cpl: d.contacts > 0 ? +(d.spend / d.contacts).toFixed(0) : 0,
      conversion: d.views > 0 ? +((d.contacts / d.views) * 100).toFixed(2) : 0,
    }));
}
