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

export type ChecklistRecommendationPriority = 'high' | 'medium' | 'low';
export type ChecklistCheckSeverity = 'bad' | 'warn';

export type ChecklistCheck = {
  group: 'Заголовок' | 'Параметры' | 'Фото/видео' | 'Текст' | 'Цена' | 'Продвижение';
  title: string;
  detail: string;
  action: string;
  severity: ChecklistCheckSeverity;
};

export type ChecklistRecommendation = {
  item: AvitoItem;
  priority: ChecklistRecommendationPriority;
  score: number;
  cpl: number | null;
  conversion: number | null;
  ctr: number | null;
  reasons: string[];
  checks: ChecklistCheck[];
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
 * Объявления без сигналов исключаем, но объявления без контактов оставляем:
 * именно они чаще всего требуют проверки по чек-листу.
 */
export function scoreItems(items: AvitoItem[], kpi: AccountKpi): ItemScore[] {
  const usable = items.filter(
    (i) =>
      i.status === 'active' &&
      (i.views >= 80 || (i.impressions ?? 0) >= 500 || i.spend >= 300 || i.favorites > 0)
  );

  const withScore: ItemScore[] = usable.map((i) => {
    const cpl = calcCpl(i.spend, i.contacts);
    const cr = calcConversion(i.views, i.contacts);

    // CPL: 1 при CPL=0, 0 при CPL=2*target
    const cplComponent =
      cpl == null
        ? i.spend > 0 && i.contacts === 0
          ? 0
          : 0.3
        : Math.max(0, Math.min(1, 1 - cpl / (kpi.targetCpl * 2)));
    // Conv: 1 при cr ≥ 2*target, 0 при cr=0
    const convComponent =
      cr == null
        ? i.views > 0 && i.contacts === 0
          ? 0
          : 0.3
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

function calcCtr(item: AvitoItem): number | null {
  if (!item.impressions || item.impressions <= 0) return null;
  return (item.views / item.impressions) * 100;
}

function titleLooksGeneric(title: string): boolean {
  const words = tokenize(title);
  const hasConcreteValue = /\d|м2|м²|кв|комн|гарант|достав|нов|б\/у|ремонт|под ключ/i.test(
    title
  );
  return words.length <= 3 && !hasConcreteValue;
}

function titleHasForbiddenContent(title: string): boolean {
  return /(скидк|телефон|whatsapp|ватсап|telegram|телеграм|\+7|8\d{10}|https?:\/\/|www\.|\.ru)/i.test(
    title
  );
}

function getAgeDays(createdAt: string): number | null {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

function pushCheck(checks: ChecklistCheck[], check: ChecklistCheck): void {
  if (checks.some((c) => c.group === check.group && c.title === check.title)) return;
  checks.push(check);
}

export function buildChecklistRecommendations(
  scored: ItemScore[],
  kpi: AccountKpi
): ChecklistRecommendation[] {
  const targetConversion = kpi.targetConversionRate || 3;
  const maxCpl = kpi.targetCpl * (1 + (kpi.allowedOverspend || 0) / 100);
  const recommendations: ChecklistRecommendation[] = [];

  for (const s of scored) {
    const item = s.item;
    const ctr = calcCtr(item);
    const checks: ChecklistCheck[] = [];
    const reasons: string[] = [];
    const hasTraffic = item.views >= 80 || (item.impressions ?? 0) >= 500;
    const noContactsWithSignal =
      item.contacts === 0 && (hasTraffic || item.spend >= kpi.targetCpl * 0.5);
    const expensiveLead = s.cpl != null && s.cpl > maxCpl;
    const weakConversion =
      s.conversion != null && s.conversion < targetConversion * 0.7 && item.views >= 80;
    const lowCtr = ctr != null && ctr < 1 && (item.impressions ?? 0) >= 500;
    const highInterestNoContact =
      item.favorites >= 4 && item.contacts === 0 && item.views >= 80;
    const lowTraffic = item.views < 80 && (item.impressions ?? 0) < 500 && item.spend > 0;
    const oldContent = (getAgeDays(item.createdAt) ?? 0) >= 21;

    if (s.bucket !== 'bottom' && s.score >= 55 && !noContactsWithSignal && !expensiveLead) {
      continue;
    }

    if (noContactsWithSignal) {
      reasons.push('есть показы/просмотры или расход, но нет обращений');
      pushCheck(checks, {
        group: 'Текст',
        title: 'Проверить первый экран описания',
        detail:
          'По чек-листу текст должен начинаться с главного УТП, акции или понятной причины обратиться.',
        action:
          'Поставьте в начало сильный оффер, условия работы, ключевые выгоды и короткий призыв к обращению.',
        severity: 'bad',
      });
    }

    if (expensiveLead) {
      reasons.push('CPL выше допустимого уровня');
      pushCheck(checks, {
        group: 'Продвижение',
        title: 'Не усиливать ставку до правки карточки',
        detail:
          'Чек-лист рекомендует сначала проверить релевантность объявления, оффер и контент, а уже потом масштабировать продвижение.',
        action:
          'Снизьте или удержите ставку, доработайте карточку и вернитесь к повышению только после улучшения конверсии.',
        severity: 'bad',
      });
    }

    if (weakConversion) {
      reasons.push('низкая конверсия из просмотров в контакты');
      pushCheck(checks, {
        group: 'Текст',
        title: 'Убрать лишнее и усилить читабельность',
        detail:
          'В чек-листе текст должен быть кратким, с разделителями, списками, акцентами, УТП и актуальными условиями.',
        action:
          'Разбейте описание на блоки: УТП, что входит, цена/условия, гарантия/доставка, призыв написать или позвонить.',
        severity: 'warn',
      });
    }

    if (lowCtr) {
      reasons.push('низкий CTR из показов в просмотры');
      pushCheck(checks, {
        group: 'Заголовок',
        title: 'Пересобрать заголовок под спрос',
        detail:
          'Чек-лист советует использовать высокочастотные запросы Авито и добавлять понятное УТП без лишних слов.',
        action:
          'Проверьте запросы в “Аналитике спроса”, добавьте главный ключ и одно УТП: доставка, гарантия, под ключ, срочно.',
        severity: 'bad',
      });
      pushCheck(checks, {
        group: 'Фото/видео',
        title: 'Заменить главное фото',
        detail:
          'Если объявление показывается, но в него не заходят, первым делом проверьте обложку: живое фото, свет, понятный объект, УТП в зоне превью.',
        action:
          'Поставьте на первое место светлое живое фото, а на 2-3 место добавьте УТП, прайс или инфографику.',
        severity: 'bad',
      });
    }

    if (titleLooksGeneric(item.title)) {
      pushCheck(checks, {
        group: 'Заголовок',
        title: 'Добавить конкретику в название',
        detail:
          'Слишком общий заголовок хуже отвечает поисковому запросу и слабее выделяется в выдаче.',
        action:
          'Добавьте тип товара/услуги, важный параметр, назначение или ограничение для целевой аудитории.',
        severity: 'warn',
      });
    }

    if (item.title.length > 70) {
      pushCheck(checks, {
        group: 'Заголовок',
        title: 'Проверить, не обрезается ли заголовок',
        detail:
          'Чек-лист отдельно предупреждает: обрезанное слово в конце заголовка может отпугнуть клиента.',
        action:
          'Откройте объявление глазами покупателя на мобильном и в десктопной выдаче, сократите слабые слова.',
        severity: 'warn',
      });
    }

    if (titleHasForbiddenContent(item.title)) {
      pushCheck(checks, {
        group: 'Заголовок',
        title: 'Убрать рискованные слова и контакты',
        detail:
          'В чек-листе запрещены телефоны, ссылки, внешние контакты и слово “скидка” в заголовке.',
        action:
          'Перенесите условия акции в текст объявления, а заголовок оставьте под запрос и УТП.',
        severity: 'bad',
      });
    }

    if (item.price <= 0) {
      reasons.push('нет понятной цены');
      pushCheck(checks, {
        group: 'Цена',
        title: 'Указать реальную цену или цену “от”',
        detail:
          'Чек-лист предупреждает, что нереальные или пустые цены дают нецелевые обращения и ухудшают качество трафика.',
        action:
          'Поставьте актуальную цену, цену “от” или диапазон, который соответствует реальным условиям сделки.',
        severity: 'bad',
      });
    } else if (highInterestNoContact) {
      reasons.push('объявление добавляют в избранное, но не обращаются');
      pushCheck(checks, {
        group: 'Цена',
        title: 'Проверить цену и условия сделки',
        detail:
          'Избранное без контактов часто означает интерес к товару, но сомнение по цене, комплектации, доставке или гарантии.',
        action:
          'Добавьте условия доставки/гарантии, актуальную акцию или объяснение, за что клиент платит.',
        severity: 'warn',
      });
    }

    if (lowTraffic) {
      reasons.push('мало трафика при наличии расхода');
      pushCheck(checks, {
        group: 'Параметры',
        title: 'Проверить заполнение параметров',
        detail:
          'Чек-лист делает акцент на обязательных и дополнительных параметрах: они помогают попасть в нужные фильтры Авито.',
        action:
          'Проверьте категорию, регион, состояние, вид объекта/услуги и все доступные характеристики в кабинете Авито.',
        severity: 'warn',
      });
    }

    if (oldContent && (s.score < 55 || noContactsWithSignal)) {
      pushCheck(checks, {
        group: 'Фото/видео',
        title: 'Обновить контент',
        detail:
          'В чек-листе есть отдельный совет регулярно обновлять контент и смотреть объявление глазами покупателя.',
        action:
          'Замените 1-2 фото, добавьте свежее УТП, прайс, видео или пример результата работы.',
        severity: 'warn',
      });
    }

    if (checks.length === 0) continue;

    const hardChecks = checks.filter((c) => c.severity === 'bad').length;
    const priority: ChecklistRecommendationPriority =
      noContactsWithSignal || expensiveLead || hardChecks >= 2
        ? 'high'
        : s.score < 45 || weakConversion
          ? 'medium'
          : 'low';

    recommendations.push({
      item,
      priority,
      score: s.score,
      cpl: s.cpl,
      conversion: s.conversion,
      ctr,
      reasons,
      checks: checks.slice(0, 4),
    });
  }

  return recommendations
    .sort((a, b) => {
      const priorityWeight = { high: 3, medium: 2, low: 1 };
      return (
        priorityWeight[b.priority] - priorityWeight[a.priority] ||
        a.score - b.score ||
        b.checks.length - a.checks.length
      );
    })
    .slice(0, 12);
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
