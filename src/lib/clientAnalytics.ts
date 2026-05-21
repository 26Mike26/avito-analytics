import type { AccountData, AccountKpi, AvitoItem, ItemMetrics } from '../types';
import {
  calcConversion,
  calcCpl,
  calcCtr,
  calculateAccountStats,
  itemsInDateRange,
  scaleKpiForPeriod,
  subcategoryName,
} from './analytics';

export type ClientPeriod = { from: string; to: string };

export type ClientMetricRow = {
  key: string;
  label: string;
  spend: number;
  leads: number;
  views: number;
  impressions: number;
  favorites: number;
  cpl: number | null;
  cr: number | null;
  ctr: number | null;
};

export type ClientAccountRow = ClientMetricRow & {
  account: AccountData;
  targetCpl: number;
  targetLeads: number;
  kpiFailed: boolean;
};

export function accountPeriodKey(period: ClientPeriod): string {
  return `${period.from}:${period.to}`;
}

export function accountViewForPeriod(account: AccountData, period: ClientPeriod): AccountData {
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

function accountSpendParts(account: AccountData, period: ClientPeriod) {
  const adsTotalFromSpendings = account.spendings
    ? account.spendings.byDate
        .filter((d) => d.date >= period.from && d.date <= period.to)
        .reduce((sum, day) => sum + day.ads, 0)
    : null;
  const otherTotalInPeriod = account.spendings
    ? account.spendings.byDate
        .filter((d) => d.date >= period.from && d.date <= period.to)
        .reduce((sum, day) => sum + Math.max(0, day.total - day.ads), 0)
    : (account.accountCharges ?? [])
        .filter((charge) => charge.date >= period.from && charge.date <= period.to)
        .filter((charge) => charge.kind === 'account_other')
        .reduce((sum, charge) => sum + charge.amount, 0);
  return { adsTotalFromSpendings, otherTotalInPeriod };
}

export function accountItemsForPeriod(account: AccountData, period: ClientPeriod): AvitoItem[] {
  const view = accountViewForPeriod(account, period);
  const spend = accountSpendParts(view, period);
  return itemsInDateRange(
    view.items,
    view.metrics,
    period.from,
    period.to,
    view.accountCharges,
    view.hasPerItemSpend,
    spend.adsTotalFromSpendings,
    spend.otherTotalInPeriod
  );
}

function summarizeItems(key: string, label: string, items: AvitoItem[]): ClientMetricRow {
  const spend = items.reduce((sum, item) => sum + item.spend, 0);
  const leads = items.reduce((sum, item) => sum + item.contacts, 0);
  const views = items.reduce((sum, item) => sum + item.views, 0);
  const impressions = items.reduce((sum, item) => sum + (item.impressions ?? 0), 0);
  const favorites = items.reduce((sum, item) => sum + item.favorites, 0);
  return {
    key,
    label,
    spend,
    leads,
    views,
    impressions,
    favorites,
    cpl: calcCpl(spend, leads),
    cr: calcConversion(views, leads),
    ctr: calcCtr(views, impressions),
  };
}

export function accountRowForPeriod(account: AccountData, period: ClientPeriod): ClientAccountRow {
  const items = accountItemsForPeriod(account, period);
  const periodKpi = scaleKpiForPeriod(account.kpi, period.from, period.to);
  const stats = calculateAccountStats(items, periodKpi);
  return {
    ...summarizeItems(account.id, account.name, items),
    account,
    targetCpl: account.kpi.targetCpl,
    targetLeads: periodKpi.targetLeads,
    kpiFailed: stats.averageCpl != null && stats.averageCpl > account.kpi.targetCpl,
  };
}

export function totalRowForPeriod(accounts: AccountData[], period: ClientPeriod): ClientMetricRow {
  return summarizeItems(
    'total',
    'Все аккаунты',
    accounts.flatMap((account) => accountItemsForPeriod(account, period))
  );
}

export function allTimeRow(accounts: AccountData[]): ClientMetricRow {
  const items = accounts.flatMap((account) => {
    const dates = account.metrics.map((m) => m.date).sort();
    if (dates.length === 0) return account.items;
    return itemsInDateRange(
      account.items,
      account.metrics,
      dates[0],
      dates[dates.length - 1],
      account.accountCharges,
      account.hasPerItemSpend
    );
  });
  return summarizeItems('all-time', 'Весь срок', items);
}

export function dailyRowsForPeriod(accounts: AccountData[], period: ClientPeriod): ClientMetricRow[] {
  const rows = new Map<string, Omit<ClientMetricRow, 'key' | 'label' | 'cpl' | 'cr' | 'ctr'>>();

  for (const accountSource of accounts) {
    const account = accountViewForPeriod(accountSource, period);
    const accountRows = new Map<string, Omit<ClientMetricRow, 'key' | 'label' | 'cpl' | 'cr' | 'ctr'>>();
    for (const metric of account.metrics.filter((m) => m.date >= period.from && m.date <= period.to)) {
      const current =
        accountRows.get(metric.date) ?? {
          spend: 0,
          leads: 0,
          views: 0,
          impressions: 0,
          favorites: 0,
        };
      current.spend += metric.spend;
      current.leads += metric.contacts;
      current.views += metric.views;
      current.impressions += metric.impressions ?? 0;
      current.favorites += metric.favorites;
      accountRows.set(metric.date, current);
    }

    if (account.spendings) {
      for (const day of account.spendings.byDate.filter((d) => d.date >= period.from && d.date <= period.to)) {
        const current =
          accountRows.get(day.date) ?? {
            spend: 0,
            leads: 0,
            views: 0,
            impressions: 0,
            favorites: 0,
          };
        current.spend = day.total;
        accountRows.set(day.date, current);
      }
    }

    for (const [date, row] of accountRows) {
      const total =
        rows.get(date) ?? {
          spend: 0,
          leads: 0,
          views: 0,
          impressions: 0,
          favorites: 0,
        };
      total.spend += row.spend;
      total.leads += row.leads;
      total.views += row.views;
      total.impressions += row.impressions;
      total.favorites += row.favorites;
      rows.set(date, total);
    }
  }

  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      key: date,
      label: date,
      ...row,
      cpl: calcCpl(row.spend, row.leads),
      cr: calcConversion(row.views, row.leads),
      ctr: calcCtr(row.views, row.impressions),
    }));
}

export function weeklyRowsFromDaily(dailyRows: ClientMetricRow[]): ClientMetricRow[] {
  const weeks = new Map<string, Omit<ClientMetricRow, 'key' | 'label' | 'cpl' | 'cr' | 'ctr'>>();
  for (const row of dailyRows) {
    const date = new Date(`${row.key}T00:00:00`);
    const monday = new Date(date);
    const day = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - day);
    const key = monday.toISOString().slice(0, 10);
    const current =
      weeks.get(key) ?? {
        spend: 0,
        leads: 0,
        views: 0,
        impressions: 0,
        favorites: 0,
      };
    current.spend += row.spend;
    current.leads += row.leads;
    current.views += row.views;
    current.impressions += row.impressions;
    current.favorites += row.favorites;
    weeks.set(key, current);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => ({
      key,
      label: `Неделя с ${key}`,
      ...row,
      cpl: calcCpl(row.spend, row.leads),
      cr: calcConversion(row.views, row.leads),
      ctr: calcCtr(row.views, row.impressions),
    }));
}

function groupItems(
  items: AvitoItem[],
  getKey: (item: AvitoItem) => string
): ClientMetricRow[] {
  const groups = new Map<string, AvitoItem[]>();
  for (const item of items) {
    const key = getKey(item) || '—';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => summarizeItems(key, key, group))
    .sort((a, b) => b.spend - a.spend);
}

export function cityRowsForPeriod(accounts: AccountData[], period: ClientPeriod): ClientMetricRow[] {
  return groupItems(
    accounts.flatMap((account) => accountItemsForPeriod(account, period)),
    (item) => item.region
  );
}

export function categoryRowsForPeriod(accounts: AccountData[], period: ClientPeriod): ClientMetricRow[] {
  return groupItems(
    accounts.flatMap((account) => accountItemsForPeriod(account, period)),
    (item) => subcategoryName(item.category)
  );
}

export function itemRowsForPeriod(accounts: AccountData[], period: ClientPeriod): ClientMetricRow[] {
  return accounts
    .flatMap((account) =>
      accountItemsForPeriod(account, period).map((item) => ({
        ...summarizeItems(`${account.id}:${item.id}`, item.title, [item]),
        accountName: account.name,
      }))
    )
    .sort((a, b) => b.spend - a.spend);
}

export function kpiForAccounts(accounts: AccountData[]): AccountKpi | null {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0].kpi;
  return null;
}
