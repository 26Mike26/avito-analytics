import type { AccountKpi, AvitoItem } from '../types';
import { calcConversion, calcCpl } from './analytics';

/**
 * Анализ объявлений: успешные vs неуспешные.
 *
 * Идея: разбить активные объявления на 3 «бакета» по итоговой эффективности
 * (CPL и конверсия), а затем сравнить лексические признаки (длину заголовка,
 * частые слова, наличие/отсутствие отдельных триггерных слов) и средние
 * метрики между топом и низом.
 *
 * Используется на странице «Инсайты по объявлениям».
 */

export type InsightBucket = 'top' | 'mid' | 'bottom';

export type ItemScore = {
  item: AvitoItem;
  bucket: InsightBucket;
  score: number; // нормированный 0..100, чем выше тем лучше
  cpl: number | null;
  conversion: number | null;
};

const STOPWORDS = new Set<string>([
  'и',
  'в',
  'на',
  'с',
  'по',
  'за',
  'от',
  'для',
  'не',
  'или',
  'до',
  'из',
  'к',
  'у',
  'о',
  'об',
  'a',
  'the',
  'of',
  'for',
  'и/или',
  'a',
]);

function tokenize(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Считаем «итоговый score» для каждого объявления:
 *  - 60% — насколько CPL ниже целевого
 *  - 40% — конверсия (просмотр→контакт) относительно целевой
 * Объявления без данных (мало просмотров и расхода) исключаем.
 */
export function scoreItems(items: AvitoItem[], kpi: AccountKpi): ItemScore[] {
  const usable = items.filter(
    (i) =>
      i.status === 'active' &&
      (i.views >= 200 || i.spend >= 1500) &&
      i.contacts > 0
  );

  const withScore: ItemScore[] = usable.map((i) => {
    const cpl = calcCpl(i.spend, i.contacts);
    const cr = calcConversion(i.views, i.contacts);

    // CPL: 1 при CPL=0, 0 при CPL=2*target
    const cplComponent = cpl == null
      ? 0.3
      : Math.max(0, Math.min(1, 1 - cpl / (kpi.targetCpl * 2)));
    // Conv: 1 при cr ≥ 2*target, 0 при cr=0
    const convComponent = cr == null
      ? 0.3
      : Math.max(0, Math.min(1, cr / (kpi.targetConversionRate * 2)));

    const score = Math.round((0.6 * cplComponent + 0.4 * convComponent) * 100);
    return { item: i, bucket: 'mid' as InsightBucket, score, cpl, conversion: cr };
  });

  if (withScore.length === 0) return [];

  // Делим по терцилям
  const sorted = [...withScore].sort((a, b) => b.score - a.score);
  const t1 = Math.ceil(sorted.length / 3);
  const t2 = Math.ceil((2 * sorted.length) / 3);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].bucket = i < t1 ? 'top' : i < t2 ? 'mid' : 'bottom';
  }
  return sorted;
}

export type WordStat = {
  word: string;
  inTop: number;
  inBottom: number;
  /** Положительный — слово чаще встречается в топе, отрицательный — в неудачных. */
  signal: number;
};

export function compareWords(scored: ItemScore[]): WordStat[] {
  const top = scored.filter((s) => s.bucket === 'top');
  const bottom = scored.filter((s) => s.bucket === 'bottom');
  if (top.length === 0 || bottom.length === 0) return [];

  const counts = new Map<string, { top: number; bottom: number }>();
  for (const s of top) {
    for (const w of new Set(tokenize(s.item.title))) {
      const c = counts.get(w) ?? { top: 0, bottom: 0 };
      c.top++;
      counts.set(w, c);
    }
  }
  for (const s of bottom) {
    for (const w of new Set(tokenize(s.item.title))) {
      const c = counts.get(w) ?? { top: 0, bottom: 0 };
      c.bottom++;
      counts.set(w, c);
    }
  }

  const totalTop = top.length;
  const totalBottom = bottom.length;
  const stats: WordStat[] = [];
  for (const [word, c] of counts.entries()) {
    if (c.top + c.bottom < 2) continue; // слишком редкое
    const topShare = c.top / totalTop;
    const bottomShare = c.bottom / totalBottom;
    const signal = topShare - bottomShare;
    stats.push({
      word,
      inTop: c.top,
      inBottom: c.bottom,
      signal: +signal.toFixed(3),
    });
  }
  return stats.sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
}

export type BucketSummary = {
  count: number;
  averageCpl: number | null;
  averageConversion: number | null;
  averageTitleLength: number;
  averagePrice: number;
  averageBid: number;
  totalContacts: number;
  totalSpend: number;
};

export function summarizeBucket(scored: ItemScore[], bucket: InsightBucket): BucketSummary {
  const list = scored.filter((s) => s.bucket === bucket);
  const n = list.length;
  if (n === 0) {
    return {
      count: 0,
      averageCpl: null,
      averageConversion: null,
      averageTitleLength: 0,
      averagePrice: 0,
      averageBid: 0,
      totalContacts: 0,
      totalSpend: 0,
    };
  }
  const totalContacts = list.reduce((s, x) => s + x.item.contacts, 0);
  const totalSpend = list.reduce((s, x) => s + x.item.spend, 0);
  const totalViews = list.reduce((s, x) => s + x.item.views, 0);
  const titleLen = list.reduce((s, x) => s + (x.item.title?.length ?? 0), 0);
  const price = list.reduce((s, x) => s + x.item.price, 0);
  const bid = list.reduce((s, x) => s + x.item.currentBid, 0);
  return {
    count: n,
    averageCpl: totalContacts > 0 ? totalSpend / totalContacts : null,
    averageConversion: totalViews > 0 ? (totalContacts / totalViews) * 100 : null,
    averageTitleLength: Math.round(titleLen / n),
    averagePrice: Math.round(price / n),
    averageBid: Math.round(bid / n),
    totalContacts,
    totalSpend,
  };
}

export type Insight = {
  level: 'good' | 'warn' | 'bad';
  message: string;
};

export function buildInsights(
  topSummary: BucketSummary,
  bottomSummary: BucketSummary,
  words: WordStat[]
): Insight[] {
  const out: Insight[] = [];
  if (topSummary.count === 0 || bottomSummary.count === 0) return out;

  // 1. Длина заголовка
  if (topSummary.averageTitleLength > bottomSummary.averageTitleLength + 10) {
    out.push({
      level: 'good',
      message: `У успешных объявлений заголовок в среднем на ${
        topSummary.averageTitleLength - bottomSummary.averageTitleLength
      } символов длиннее (${topSummary.averageTitleLength} vs ${bottomSummary.averageTitleLength}). Добавляйте больше конкретики в название.`,
    });
  } else if (topSummary.averageTitleLength < bottomSummary.averageTitleLength - 10) {
    out.push({
      level: 'good',
      message: `У успешных заголовки короче и ёмче (${topSummary.averageTitleLength} vs ${bottomSummary.averageTitleLength} символов).`,
    });
  }

  // 2. CPL
  if (
    topSummary.averageCpl != null &&
    bottomSummary.averageCpl != null &&
    bottomSummary.averageCpl > topSummary.averageCpl * 1.5
  ) {
    out.push({
      level: 'bad',
      message: `Неуспешные объявления стоят в ${(
        bottomSummary.averageCpl / topSummary.averageCpl
      ).toFixed(1)}× дороже за лид. Снизьте ставки и доработайте контент.`,
    });
  }

  // 3. Цена
  if (topSummary.averagePrice && bottomSummary.averagePrice) {
    const ratio = bottomSummary.averagePrice / topSummary.averagePrice;
    if (ratio > 1.3) {
      out.push({
        level: 'warn',
        message: `Неудачные объявления в среднем дороже на ${Math.round(
          (ratio - 1) * 100
        )}% — возможно, цена выглядит непривлекательно для целевой аудитории.`,
      });
    }
    if (ratio < 0.75) {
      out.push({
        level: 'good',
        message: `Успешные объявления в более высоком ценовом сегменте — продолжайте работать с маржинальными лотами.`,
      });
    }
  }

  // 4. Сильные слова (топ-3 положительные)
  const winWords = words.filter((w) => w.signal > 0.2).slice(0, 3);
  if (winWords.length > 0) {
    out.push({
      level: 'good',
      message: `Слова, чаще встречающиеся в успешных заголовках: ${winWords
        .map((w) => `«${w.word}»`)
        .join(', ')}. Попробуйте добавить их в новые объявления.`,
    });
  }
  const looseWords = words.filter((w) => w.signal < -0.2).slice(0, 3);
  if (looseWords.length > 0) {
    out.push({
      level: 'warn',
      message: `Слова, преобладающие у неудачных: ${looseWords
        .map((w) => `«${w.word}»`)
        .join(', ')}. Проверьте, не размывают ли они смысл.`,
    });
  }

  return out;
}
