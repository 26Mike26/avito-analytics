import type {
  AccountDailySpend,
  AccountData,
  AvitoItem,
  ItemDailyStat,
  ItemMetrics,
  StatsAccuracy,
} from '../types';
import type { FilteredSpendingsByDate, SpendingsBreakdown } from './AvitoAdapter';

export type CachedPeriodData = {
  items: AvitoItem[];
  metrics: ItemMetrics[];
  spendings: SpendingsBreakdown | null;
  hasPerItemSpend: boolean;
};

type DateRange = { from: string; to: string };

function round(value: unknown): number {
  return Math.max(0, Math.round(Number(value ?? 0)));
}

function inRange(date: string, period?: DateRange): boolean {
  return !period || (date >= period.from && date <= period.to);
}

function metricKey(metric: Pick<ItemMetrics, 'itemId' | 'date'>): string {
  return `${metric.itemId}:${metric.date}`;
}

export function itemDailyStatsFromMetrics(
  accountId: string,
  metrics: ItemMetrics[],
  accuracy: StatsAccuracy
): ItemDailyStat[] {
  return metrics.map((m) => ({
    accountId,
    itemId: String(m.itemId),
    date: m.date,
    views: round(m.views),
    impressions: round(m.impressions),
    contacts: round(m.contacts),
    favorites: round(m.favorites),
    spend: round(m.spend),
    bid: round(m.bid),
    accuracy,
  }));
}

export function itemDailyStatsFromExactSpendRows(
  accountId: string,
  itemId: string,
  metrics: ItemMetrics[],
  spendRows: FilteredSpendingsByDate[]
): ItemDailyStat[] {
  const metricByDate = new Map(
    metrics
      .filter((m) => String(m.itemId) === String(itemId))
      .map((m) => [m.date, m])
  );
  const spendByDate = new Map(spendRows.map((row) => [row.date, row]));
  const dates = Array.from(
    new Set([...metricByDate.keys(), ...spendByDate.keys()])
  ).sort();

  return dates.map((date) => {
    const metric = metricByDate.get(date);
    const spend = spendByDate.get(date);
    return {
      accountId,
      itemId: String(itemId),
      date,
      views: round(metric?.views),
      impressions: round(metric?.impressions),
      contacts: round(metric?.contacts),
      favorites: round(metric?.favorites),
      spend: round(spend?.total ?? metric?.spend),
      bid: round(metric?.bid),
      accuracy: spend ? 'exact' : 'partial',
    };
  });
}

export function accountDailySpendFromSpendings(
  accountId: string,
  spendings: SpendingsBreakdown | null,
  accuracy: StatsAccuracy = 'exact'
): AccountDailySpend[] {
  if (!spendings) return [];
  return spendings.byDate.map((row) => {
    const promotion = round(row.promotion);
    const presence = round(row.presence);
    const ads = round(row.ads ?? promotion + presence);
    const total = round(row.total);
    const commission = round(row.commission ?? Math.max(0, total - ads));
    const rest = round(row.rest);
    return {
      accountId,
      date: row.date,
      promotion,
      presence,
      commission,
      rest,
      ads,
      total,
      accuracy,
    };
  });
}

export function spendingsFromDailyRows(
  rows: AccountDailySpend[]
): SpendingsBreakdown | null {
  if (rows.length === 0) return null;
  const byDate = rows
    .map((row) => {
      const promotion = round(row.promotion);
      const presence = round(row.presence);
      const commission = round(row.commission);
      const rest = round(row.rest);
      const ads = round(row.ads || promotion + presence);
      const total = round(row.total || ads + commission + rest);
      return { date: row.date, promotion, presence, commission, rest, ads, total };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    promotion: byDate.reduce((s, d) => s + d.promotion, 0),
    presence: byDate.reduce((s, d) => s + d.presence, 0),
    commission: rows.reduce((s, d) => s + round(d.commission), 0),
    rest: rows.reduce((s, d) => s + round(d.rest), 0),
    total: byDate.reduce((s, d) => s + d.total, 0),
    byDate,
  };
}

export function metricsFromDailyStats(rows: ItemDailyStat[]): ItemMetrics[] {
  return rows
    .map((row) => ({
      itemId: String(row.itemId),
      date: row.date,
      views: round(row.views),
      impressions: round(row.impressions),
      contacts: round(row.contacts),
      favorites: round(row.favorites),
      spend: round(row.spend),
      bid: round(row.bid),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.itemId.localeCompare(b.itemId));
}

function mergeDailyStatsIntoMetrics(
  baseMetrics: ItemMetrics[],
  rows: ItemDailyStat[],
  period?: DateRange
): ItemMetrics[] {
  const byKey = new Map<string, ItemMetrics>();
  for (const metric of baseMetrics.filter((m) => inRange(m.date, period))) {
    byKey.set(metricKey(metric), metric);
  }
  for (const metric of metricsFromDailyStats(rows)) {
    byKey.set(metricKey(metric), metric);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.itemId.localeCompare(b.itemId)
  );
}

export function itemsFromDailyStats(
  baseItems: AvitoItem[],
  rows: ItemDailyStat[]
): AvitoItem[] {
  const byItem = new Map<
    string,
    { views: number; impressions: number; contacts: number; favorites: number; spend: number }
  >();

  for (const row of rows) {
    const key = String(row.itemId);
    const cur =
      byItem.get(key) ?? { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 };
    cur.views += round(row.views);
    cur.impressions += round(row.impressions);
    cur.contacts += round(row.contacts);
    cur.favorites += round(row.favorites);
    cur.spend += round(row.spend);
    byItem.set(key, cur);
  }

  return baseItems.map((item) => {
    const totals = byItem.get(String(item.id));
    if (!totals) {
      return { ...item, views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 };
    }
    return {
      ...item,
      views: totals.views,
      impressions: totals.impressions,
      contacts: totals.contacts,
      favorites: totals.favorites,
      spend: totals.spend,
    };
  });
}

function itemsFromMetrics(
  baseItems: AvitoItem[],
  metrics: ItemMetrics[],
  period?: DateRange
): AvitoItem[] {
  const byItem = new Map<
    string,
    { views: number; impressions: number; contacts: number; favorites: number; spend: number }
  >();

  for (const row of metrics.filter((m) => inRange(m.date, period))) {
    const key = String(row.itemId);
    const cur =
      byItem.get(key) ?? { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 };
    cur.views += round(row.views);
    cur.impressions += round(row.impressions);
    cur.contacts += round(row.contacts);
    cur.favorites += round(row.favorites);
    cur.spend += round(row.spend);
    byItem.set(key, cur);
  }

  return baseItems.map((item) => {
    const totals = byItem.get(String(item.id));
    if (!totals) return item;
    return {
      ...item,
      views: totals.views,
      impressions: totals.impressions,
      contacts: totals.contacts,
      favorites: totals.favorites,
      spend: totals.spend,
    };
  });
}

export function hasExactItemSpend(rows: ItemDailyStat[]): boolean {
  const spendRelevantRows = rows.filter(
    (row) => round(row.spend) > 0 || round(row.contacts) > 0
  );
  return (
    spendRelevantRows.length > 0 &&
    spendRelevantRows.every((row) => row.accuracy === 'exact')
  );
}

export function buildCachedPeriodData(
  account: AccountData,
  itemRows: ItemDailyStat[],
  spendRows: AccountDailySpend[],
  period?: DateRange
): CachedPeriodData | null {
  if (itemRows.length === 0 && spendRows.length === 0) return null;
  const metrics =
    itemRows.length > 0
      ? mergeDailyStatsIntoMetrics(account.metrics, itemRows, period)
      : account.metrics.filter((m) => inRange(m.date, period));
  const hasBaseRowsOutsideCache = metrics.length > itemRows.length;
  return {
    items: metrics.length > 0 ? itemsFromMetrics(account.items, metrics, period) : account.items,
    metrics,
    spendings: spendingsFromDailyRows(spendRows) ?? account.spendings ?? null,
    hasPerItemSpend: hasBaseRowsOutsideCache
      ? Boolean(account.hasPerItemSpend)
      : hasExactItemSpend(itemRows),
  };
}
