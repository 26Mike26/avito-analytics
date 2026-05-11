import type { AvitoItem, ItemMetrics } from '../types';
import { calcConversion, calcCpl } from './analytics';

/**
 * Утилиты для сравнения двух периодов.
 *
 * Сравнивать можно:
 *  1. Два диапазона дат поверх существующих метрик (когда метрики содержат
 *     запись за каждый день — например, после синхронизации с Авито API).
 *  2. Два независимо загруженных CSV (период A и период Б — пользователь
 *     выгружает из ЛК Авито две выгрузки по разным неделям).
 *
 * Результат: агрегаты per-период + diff по объявлениям.
 */

export type PeriodAggregate = {
  label: string;
  views: number;
  contacts: number;
  spend: number;
  favorites: number;
  cpl: number | null;
  conversion: number | null;
  itemCount: number;
};

export type ItemDiff = {
  itemId: string;
  title: string;
  status?: AvitoItem['status'];
  a: { views: number; contacts: number; spend: number; cpl: number | null };
  b: { views: number; contacts: number; spend: number; cpl: number | null };
  deltaViews: number;
  deltaContacts: number;
  deltaSpend: number;
  // относительная (для сортировки) — изменение CPL в %
  cplChangePercent: number | null;
  contactsChangePercent: number | null;
};

export type CityDiff = {
  region: string;
  a: { views: number; contacts: number; spend: number; cpl: number | null };
  b: { views: number; contacts: number; spend: number; cpl: number | null };
  deltaContacts: number;
  deltaSpend: number;
  cplChangePercent: number | null;
  contactsChangePercent: number | null;
};

export type PeriodComparison = {
  a: PeriodAggregate;
  b: PeriodAggregate;
  delta: {
    views: { abs: number; percent: number };
    contacts: { abs: number; percent: number };
    spend: { abs: number; percent: number };
    cpl: { abs: number | null; percent: number | null };
    conversion: { abs: number | null; percent: number | null };
  };
  cities: CityDiff[];
  items: ItemDiff[];
};

function hasActivity(item: AvitoItem): boolean {
  return item.views > 0 || item.contacts > 0 || item.favorites > 0 || item.spend > 0;
}

function cleanRegion(region: string): string {
  const s = (region ?? '').trim();
  if (!s) return '—';
  return s.split(',')[0].replace(/^г\.?\s*/i, '').trim() || '—';
}

function aggregateItems(items: AvitoItem[], label: string): PeriodAggregate {
  const active = items.filter(hasActivity);
  const views = active.reduce((s, i) => s + i.views, 0);
  const contacts = active.reduce((s, i) => s + i.contacts, 0);
  const spend = active.reduce((s, i) => s + i.spend, 0);
  const favorites = active.reduce((s, i) => s + i.favorites, 0);
  return {
    label,
    views,
    contacts,
    spend,
    favorites,
    cpl: calcCpl(spend, contacts),
    conversion: calcConversion(views, contacts),
    itemCount: active.length,
  };
}

function diffPercent(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / Math.abs(a)) * 100;
}

function diffNullable(a: number | null, b: number | null): { abs: number | null; percent: number | null } {
  if (a == null && b == null) return { abs: null, percent: null };
  if (a == null || b == null) {
    return { abs: a == null ? b : -a, percent: null };
  }
  return {
    abs: +(b - a).toFixed(2),
    percent: +diffPercent(a, b).toFixed(1),
  };
}

/**
 * Сравнение двух периодов поверх массивов метрик.
 * `itemsA`/`itemsB` — снимки объявлений на каждый период (для названий и статусов).
 */
export function comparePeriods(
  metricsA: ItemMetrics[],
  metricsB: ItemMetrics[],
  itemsA: AvitoItem[],
  itemsB: AvitoItem[],
  labelA = 'Период A',
  labelB = 'Период Б'
): PeriodComparison {
  const periodItemsA = itemsA.filter(hasActivity);
  const periodItemsB = itemsB.filter(hasActivity);
  const a = aggregateItems(periodItemsA, labelA);
  const b = aggregateItems(periodItemsB, labelB);

  const titleByItem = new Map<string, AvitoItem>();
  for (const it of itemsB) titleByItem.set(it.id, it);
  for (const it of itemsA) if (!titleByItem.has(it.id)) titleByItem.set(it.id, it);

  // суммируем метрики по объявлению в каждом периоде
  const sumByItem = (items: AvitoItem[]) => {
    const m = new Map<string, { views: number; contacts: number; spend: number }>();
    for (const x of items) {
      const cur = m.get(x.id) ?? { views: 0, contacts: 0, spend: 0 };
      cur.views += x.views;
      cur.contacts += x.contacts;
      cur.spend += x.spend;
      m.set(x.id, cur);
    }
    return m;
  };

  const aMap = sumByItem(periodItemsA);
  const bMap = sumByItem(periodItemsB);
  const allIds = new Set<string>([...aMap.keys(), ...bMap.keys()]);

  const items: ItemDiff[] = [];
  for (const id of allIds) {
    const av = aMap.get(id) ?? { views: 0, contacts: 0, spend: 0 };
    const bv = bMap.get(id) ?? { views: 0, contacts: 0, spend: 0 };
    const cplA = calcCpl(av.spend, av.contacts);
    const cplB = calcCpl(bv.spend, bv.contacts);
    const item = titleByItem.get(id);
    items.push({
      itemId: id,
      title: item?.title ?? `Объявление ${id}`,
      status: item?.status,
      a: { ...av, cpl: cplA },
      b: { ...bv, cpl: cplB },
      deltaViews: bv.views - av.views,
      deltaContacts: bv.contacts - av.contacts,
      deltaSpend: bv.spend - av.spend,
      cplChangePercent:
        cplA != null && cplB != null
          ? +diffPercent(cplA, cplB).toFixed(1)
          : null,
      contactsChangePercent:
        av.contacts > 0 ? +diffPercent(av.contacts, bv.contacts).toFixed(1) : null,
    });
  }

  // Сортируем по абсолютному изменению контактов
  items.sort((x, y) => Math.abs(y.deltaContacts) - Math.abs(x.deltaContacts));

  const sumByRegion = (items: AvitoItem[]) => {
    const m = new Map<string, { views: number; contacts: number; spend: number }>();
    for (const x of items) {
      const region = cleanRegion(x.region);
      const cur = m.get(region) ?? { views: 0, contacts: 0, spend: 0 };
      cur.views += x.views;
      cur.contacts += x.contacts;
      cur.spend += x.spend;
      m.set(region, cur);
    }
    return m;
  };

  const aCityMap = sumByRegion(periodItemsA);
  const bCityMap = sumByRegion(periodItemsB);
  const allRegions = new Set<string>([...aCityMap.keys(), ...bCityMap.keys()]);
  const cities: CityDiff[] = [];
  for (const region of allRegions) {
    const av = aCityMap.get(region) ?? { views: 0, contacts: 0, spend: 0 };
    const bv = bCityMap.get(region) ?? { views: 0, contacts: 0, spend: 0 };
    const cplA = calcCpl(av.spend, av.contacts);
    const cplB = calcCpl(bv.spend, bv.contacts);
    cities.push({
      region,
      a: { ...av, cpl: cplA },
      b: { ...bv, cpl: cplB },
      deltaContacts: bv.contacts - av.contacts,
      deltaSpend: bv.spend - av.spend,
      cplChangePercent:
        cplA != null && cplB != null
          ? +diffPercent(cplA, cplB).toFixed(1)
          : null,
      contactsChangePercent:
        av.contacts > 0 ? +diffPercent(av.contacts, bv.contacts).toFixed(1) : null,
    });
  }
  cities.sort((x, y) => {
    const contactDelta = Math.abs(y.deltaContacts) - Math.abs(x.deltaContacts);
    if (contactDelta !== 0) return contactDelta;
    return Math.abs(y.deltaSpend) - Math.abs(x.deltaSpend);
  });

  return {
    a,
    b,
    delta: {
      views: { abs: b.views - a.views, percent: +diffPercent(a.views, b.views).toFixed(1) },
      contacts: { abs: b.contacts - a.contacts, percent: +diffPercent(a.contacts, b.contacts).toFixed(1) },
      spend: { abs: b.spend - a.spend, percent: +diffPercent(a.spend, b.spend).toFixed(1) },
      cpl: diffNullable(a.cpl, b.cpl),
      conversion: diffNullable(a.conversion, b.conversion),
    },
    cities,
    items,
  };
}

/**
 * Фильтрует метрики по диапазону дат (включительно).
 * Даты ожидаются в формате 'YYYY-MM-DD'.
 */
export function filterMetricsByDate(
  metrics: ItemMetrics[],
  from: string,
  to: string
): ItemMetrics[] {
  return metrics.filter((m) => m.date >= from && m.date <= to);
}

/**
 * Готовые подсказки диапазонов: «прошлая неделя» и «текущая неделя».
 * Возвращает кортежи в формате 'YYYY-MM-DD'.
 */
export function defaultRanges(today = new Date()): {
  prevWeek: { from: string; to: string };
  thisWeek: { from: string; to: string };
  prev30: { from: string; to: string };
  this30: { from: string; to: string };
} {
  const t = new Date(today);
  // Понедельник текущей недели
  const day = t.getDay() === 0 ? 7 : t.getDay();
  const thisWeekStart = new Date(t);
  thisWeekStart.setDate(t.getDate() - (day - 1));
  thisWeekStart.setHours(0, 0, 0, 0);
  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
  const prevWeekStart = new Date(thisWeekStart);
  prevWeekStart.setDate(thisWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(thisWeekStart);
  prevWeekEnd.setDate(thisWeekStart.getDate() - 1);

  const today30End = new Date(t);
  const today30Start = new Date(t);
  today30Start.setDate(t.getDate() - 29);
  const prev30End = new Date(today30Start);
  prev30End.setDate(today30Start.getDate() - 1);
  const prev30Start = new Date(prev30End);
  prev30Start.setDate(prev30End.getDate() - 29);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    prevWeek: { from: fmt(prevWeekStart), to: fmt(prevWeekEnd) },
    thisWeek: { from: fmt(thisWeekStart), to: fmt(thisWeekEnd) },
    prev30: { from: fmt(prev30Start), to: fmt(prev30End) },
    this30: { from: fmt(today30Start), to: fmt(today30End) },
  };
}
