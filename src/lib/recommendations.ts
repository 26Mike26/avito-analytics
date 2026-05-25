import type {
  AccountKpi,
  AvitoItem,
  ItemMetrics,
  Recommendation,
  RecommendationPriority,
} from '../types';
import {
  calcConversion,
  calcCpl,
  calculateAccountStats,
  classifyItem,
  formatPercent,
  formatRub,
  subcategoryName,
} from './analytics';

const MAX_BID_INCREASE_PERCENT = 25;
const MAX_BID_DECREASE_PERCENT = 30;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function id() {
  return `rec-${Math.random().toString(36).slice(2, 10)}`;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Типы решений по продвижению — взяты из avito-skill `references/decision-rules.md`
 * и `scripts/promotion_decision_preview.py:preview_decision`.
 */
export type Decision =
  | 'promote_candidate'
  | 'do_not_promote_yet'
  | 'improve_listing_first'
  | 'stop_or_reduce_spend'
  | 'test_low_budget'
  | 'inspect_current_promotion'
  | 'scale_paid'
  | 'pause_or_archive'
  | 'no_change';

export const decisionLabels: Record<Decision, string> = {
  promote_candidate: 'Кандидат на продвижение',
  do_not_promote_yet: 'Пока не продвигать',
  improve_listing_first: 'Сначала улучшить объявление',
  stop_or_reduce_spend: 'Остановить или снизить расход',
  test_low_budget: 'Протестировать на низком бюджете',
  inspect_current_promotion: 'Проверить текущую кампанию',
  scale_paid: 'Масштабировать платное продвижение',
  pause_or_archive: 'Поставить на паузу или архив',
  no_change: 'Без изменений',
};

export type BidRecommendation = {
  itemId: string;
  current: number;
  recommended: number;
  diffPercent: number;
  reason: string;
  reasons: string[];
  priority: RecommendationPriority;
  confidence: Confidence;
  decision: Decision;
  forecastSpend: number;
  forecastContacts: number;
  forecastSpendDelta: number;
  needsConfirm: boolean;
  thinData: boolean;
  trend: 'up' | 'down' | 'flat' | 'unknown';
};

function median(values: number[]): number | null {
  const arr = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

/**
 * Вычисляет тренд по последним 7 дням для конкретного объявления.
 * Возвращает 'up' / 'down' / 'flat' / 'unknown'.
 */
function calcTrend(metrics: ItemMetrics[], itemId: string): BidRecommendation['trend'] {
  const series = metrics
    .filter((m) => m.itemId === itemId)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 4) return 'unknown';
  const last = series.slice(-7);
  const half = Math.floor(last.length / 2);
  const earlySpend = last.slice(0, half).reduce((s, m) => s + m.contacts, 0);
  const lateSpend = last.slice(-half).reduce((s, m) => s + m.contacts, 0);
  if (earlySpend === 0 && lateSpend === 0) return 'flat';
  const diff = lateSpend - earlySpend;
  const base = Math.max(1, earlySpend);
  const ratio = diff / base;
  if (ratio > 0.2) return 'up';
  if (ratio < -0.2) return 'down';
  return 'flat';
}

export type CategoryStats = {
  medianCpl: number | null;
  medianConversion: number | null;
};

/**
 * Категории, в которых есть несколько эффективных объявлений (CPL ≤ цели).
 * Используется для рекомендаций расширения ассортимента.
 */
function categoryWinners(
  items: AvitoItem[],
  kpi: AccountKpi
): Array<{ category: string; winners: number; medianCpl: number | null }> {
  const groups = new Map<string, { items: AvitoItem[]; cpls: number[] }>();
  for (const it of items) {
    if (it.status !== 'active') continue;
    const cpl = calcCpl(it.spend, it.contacts);
    const key = subcategoryName(it.category);
    const g = groups.get(key) ?? { items: [], cpls: [] };
    g.items.push(it);
    if (cpl != null) g.cpls.push(cpl);
    groups.set(key, g);
  }
  const out: Array<{ category: string; winners: number; medianCpl: number | null }> = [];
  for (const [cat, g] of groups.entries()) {
    const winners = g.items.filter((i) => {
      const cpl = calcCpl(i.spend, i.contacts);
      return cpl != null && cpl <= kpi.targetCpl && i.contacts >= 3;
    }).length;
    if (winners >= 2) {
      out.push({ category: cat, winners, medianCpl: median(g.cpls) });
    }
  }
  return out.sort((a, b) => b.winners - a.winners);
}

/**
 * Регионы с минимальным присутствием — потенциальные кандидаты на расширение.
 * Берём «соседей» рядом с уже активными регионами по простому списку.
 */
function regionExpansionCandidates(items: AvitoItem[], _kpi: AccountKpi): string[] {
  void _kpi;
  const presentRegions = new Set(
    items.filter((i) => i.status === 'active').map((i) => i.region)
  );
  const candidatePool = [
    'Москва',
    'Санкт-Петербург',
    'Екатеринбург',
    'Казань',
    'Новосибирск',
    'Краснодар',
    'Нижний Новгород',
    'Самара',
    'Ростов-на-Дону',
  ];
  return candidatePool.filter((r) => !presentRegions.has(r)).slice(0, 5);
}

function computeCategoryStats(items: AvitoItem[]): Map<string, CategoryStats> {
  const groups = new Map<string, { cpls: number[]; convs: number[] }>();
  for (const it of items) {
    const cpl = calcCpl(it.spend, it.contacts);
    const cr = calcConversion(it.views, it.contacts);
    const key = subcategoryName(it.category);
    const g = groups.get(key) ?? { cpls: [], convs: [] };
    if (cpl != null) g.cpls.push(cpl);
    if (cr != null) g.convs.push(cr);
    groups.set(key, g);
  }
  const out = new Map<string, CategoryStats>();
  for (const [cat, v] of groups.entries()) {
    out.set(cat, {
      medianCpl: median(v.cpls),
      medianConversion: median(v.convs),
    });
  }
  return out;
}

/**
 * Порт логики `preview_decision` из avito-skill (`scripts/promotion_decision_preview.py`).
 * Возвращает один из ярлыков решения и риск.
 *
 * Используется для классификации, к какой группе действий относится объявление,
 * прежде чем мы предложим конкретную ставку.
 */
export function previewDecision(
  views: number,
  contacts: number,
  spend: number,
  hasPromotion: boolean
): { decision: Decision; risk: 'low' | 'medium' | 'high' } {
  const conversion = views > 0 ? contacts / views : 0;
  if (hasPromotion) {
    return {
      decision: 'inspect_current_promotion',
      risk: 'medium',
    };
  }
  if (views <= 0 && spend <= 0) {
    return { decision: 'test_low_budget', risk: 'medium' };
  }
  if (views > 1000 && contacts <= 0) {
    return { decision: 'improve_listing_first', risk: 'high' };
  }
  if (spend > 1000 && contacts <= 0) {
    return { decision: 'stop_or_reduce_spend', risk: 'high' };
  }
  if (conversion > 0 && contacts >= 5) {
    return { decision: 'promote_candidate', risk: 'medium' };
  }
  return { decision: 'do_not_promote_yet', risk: 'low' };
}

export function calculateBidRecommendation(
  item: AvitoItem,
  kpi: AccountKpi,
  metrics: ItemMetrics[] = [],
  categoryStats?: Map<string, CategoryStats>
): BidRecommendation {
  const cpl = calcCpl(item.spend, item.contacts);
  const cr = calcConversion(item.views, item.contacts);
  const dataIsThin = item.views < 200 && item.spend < 1500;
  const trend = calcTrend(metrics, item.id);
  const catStat = categoryStats?.get(subcategoryName(item.category));

  let diff = 0;
  let priority: RecommendationPriority = 'low';
  const reasons: string[] = [];

  // Уверенность зависит от объёма данных
  let confidence: Confidence = 'medium';
  if (dataIsThin || (item.views < 500 && item.contacts < 5)) confidence = 'low';
  if (item.views > 1500 && item.contacts >= 8) confidence = 'high';

  if (dataIsThin) {
    diff = 0;
    reasons.push('недостаточно данных для уверенной рекомендации');
    priority = 'low';
  } else if (item.spend > 1000 && item.contacts === 0) {
    const overshoot = Math.min(20, Math.round(item.spend / 500));
    diff = -clamp(overshoot, 5, MAX_BID_DECREASE_PERCENT);
    reasons.push(`за период расход ${formatRub(item.spend)} без единого обращения`);
    if (trend === 'down') reasons.push('контактов нет уже несколько дней подряд');
    priority = 'high';
  } else if (cpl != null && cpl > kpi.targetCpl * 1.25) {
    const overshoot = (cpl / kpi.targetCpl - 1) * 100;
    diff = -clamp(Math.round(overshoot * 0.6), 5, MAX_BID_DECREASE_PERCENT);
    reasons.push(
      `текущий CPL ${formatRub(cpl)} выше цели ${formatRub(kpi.targetCpl)} на ${formatPercent(overshoot, 0)}`
    );
    if (catStat?.medianCpl && cpl > catStat.medianCpl * 1.2) {
      reasons.push(
        `и выше медианы по «${subcategoryName(item.category)}» (${formatRub(catStat.medianCpl)})`
      );
    }
    if (trend === 'down') reasons.push('к тому же контакты падают неделя к неделе');
    priority = 'high';
  } else if (
    cr != null &&
    cr < kpi.targetConversionRate * 0.6 &&
    item.views > 1000
  ) {
    diff = 0;
    reasons.push(
      `при ${item.views.toLocaleString('ru-RU')} просмотрах конверсия всего ${formatPercent(cr)}`
    );
    if (catStat?.medianConversion && cr < catStat.medianConversion * 0.7) {
      reasons.push(
        `это ниже медианы «${subcategoryName(item.category)}» (${formatPercent(catStat.medianConversion)})`
      );
    }
    reasons.push('повышать ставку нет смысла — нужно поправить контент');
    priority = 'medium';
  } else if (cpl != null && cpl < kpi.targetCpl * 0.85 && item.contacts >= 5) {
    const underrun = (1 - cpl / kpi.targetCpl) * 100;
    diff = clamp(Math.round(underrun * 0.6), 5, MAX_BID_INCREASE_PERCENT);
    reasons.push(
      `CPL ${formatRub(cpl)} ниже цели на ${formatPercent(underrun, 0)}`
    );
    if (trend === 'up') reasons.push('контакты растут неделя к неделе');
    if (item.contacts >= 15) reasons.push('накоплена устойчивая статистика');
    priority = 'high';
  } else if (item.views < 300 && item.contacts > 0 && cpl != null && cpl <= kpi.targetCpl) {
    diff = 8;
    reasons.push('охват пока низкий');
    reasons.push('но при этом цена лида в норме — есть потенциал масштабирования');
    priority = 'medium';
  } else {
    reasons.push('показатели в пределах нормы — изменений не требуется');
  }

  // Стратегия влияет на агрессивность
  if (kpi.strategy === 'leads' && diff >= 0)
    diff = clamp(diff + 3, 0, MAX_BID_INCREASE_PERCENT);
  if (kpi.strategy === 'cpl' && diff <= 0)
    diff = clamp(diff - 2, -MAX_BID_DECREASE_PERCENT, 0);
  if (kpi.strategy === 'roi' && diff > 0)
    diff = clamp(diff - 2, 0, MAX_BID_INCREASE_PERCENT);

  // Низкая уверенность — снижаем агрессивность
  if (confidence === 'low') diff = Math.round(diff * 0.5);

  const recommended = Math.max(1, Math.round(item.currentBid * (1 + diff / 100)));
  const forecastSpend = Math.round(item.spend * (1 + diff / 100));
  const baseContacts = Math.max(1, item.contacts);
  const forecastContacts = Math.max(
    0,
    Math.round(baseContacts * (1 + (diff / 100) * 0.6))
  );
  const forecastSpendDelta = forecastSpend - item.spend;

  const reason = reasons.length
    ? 'Потому что ' + reasons.join('; ') + '.'
    : 'Изменения не требуются.';
  const needsConfirm = diff > 15;
  const { decision } = previewDecision(item.views, item.contacts, item.spend, item.spend > 0);

  return {
    itemId: item.id,
    current: item.currentBid,
    recommended,
    diffPercent: diff,
    reason,
    reasons,
    priority,
    confidence,
    decision,
    forecastSpend,
    forecastContacts,
    forecastSpendDelta,
    needsConfirm,
    thinData: dataIsThin,
    trend,
  };
}

export function applyBidRecommendationsToItems(
  items: AvitoItem[],
  kpi: AccountKpi,
  metrics: ItemMetrics[] = []
): AvitoItem[] {
  const cat = computeCategoryStats(items);
  return items.map((item) => {
    const rec = calculateBidRecommendation(item, kpi, metrics, cat);
    return { ...item, recommendedBid: rec.recommended };
  });
}

export function buildRecommendations(
  items: AvitoItem[],
  kpi: AccountKpi,
  metrics: ItemMetrics[] = []
): Recommendation[] {
  const out: Recommendation[] = [];
  const stats = calculateAccountStats(items, kpi);
  const cat = computeCategoryStats(items);

  // KPI / аккаунт
  if (stats.budgetUsage > 100) {
    out.push({
      id: id(),
      priority: 'high',
      type: 'budget',
      group: 'Проблемы с KPI',
      title: 'Превышен месячный бюджет',
      description: `Расход ${formatRub(stats.totalSpend)} превысил план ${formatRub(
        kpi.monthlyBudget
      )} на ${formatPercent(stats.budgetUsage - 100, 0)}. Снизьте ставки на наименее эффективных объявлениях, чтобы вернуться в рамки бюджета.`,
      expectedEffect: `Экономия ~${formatRub(stats.totalSpend - kpi.monthlyBudget)} в месяц.`,
      actionLabel: 'Перейти к ставкам',
      status: 'new',
    });
  }
  if (stats.averageCpl != null && stats.averageCpl > kpi.targetCpl * 1.15) {
    const delta = stats.averageCpl - kpi.targetCpl;
    out.push({
      id: id(),
      priority: 'high',
      type: 'kpi',
      group: 'Проблемы с KPI',
      title: 'Средний CPL выше целевого',
      description: `Текущий средний CPL ${formatRub(
        stats.averageCpl
      )}, цель ${formatRub(kpi.targetCpl)} (разница ${formatRub(delta)}). Сильнее всего тянут вниз объявления с перерасходом — начните с них.`,
      expectedEffect: `Снижение средней цены лида до целевого уровня (~${formatRub(kpi.targetCpl)}).`,
      actionLabel: 'Снизить перерасход',
      status: 'new',
    });
  }
  if (stats.leadsProgress < 70) {
    out.push({
      id: id(),
      priority: 'medium',
      type: 'kpi',
      group: 'Проблемы с KPI',
      title: 'Отставание от плана по лидам',
      description: `Получено ${stats.totalContacts} лидов из ${kpi.targetLeads} (${formatPercent(
        stats.leadsProgress,
        0
      )}). Безопаснее всего масштабировать те объявления, которые уже укладываются в целевой CPL.`,
      expectedEffect: `Дополнительно ~${Math.max(
        0,
        kpi.targetLeads - stats.totalContacts
      )} лидов до конца периода.`,
      actionLabel: 'Масштабировать',
      status: 'new',
    });
  }

  // ─── Lead Leakage (на основе соотношения избранное/контакты)
  // Если объявление часто добавляют в избранное, но мало пишут — это не утечка
  // лидов в нашем смысле, но это сигнал, что контакт не происходит после интереса
  // (см. business-scenarios.md → "Lead Leakage").
  const leakage = items.filter(
    (i) =>
      i.status === 'active' &&
      i.favorites > 10 &&
      i.contacts > 0 &&
      i.favorites / Math.max(1, i.contacts) > 5
  );
  if (leakage.length > 0) {
    out.push({
      id: id(),
      priority: 'medium',
      type: 'content',
      group: 'Lead Leakage',
      title: `Утечка интереса в ${leakage.length} объявлениях`,
      description:
        'Объявления часто сохраняют в избранное, но звонят и пишут редко. Это сигнал, что цена или условия выглядят непривлекательно вблизи. Проверьте цену, описание условий, скорость ответа на чаты и доступность связи.',
      expectedEffect: 'Рост конверсии из избранного в контакт.',
      actionLabel: 'Посмотреть объявления',
      status: 'new',
    });
  }

  // ─── Stale inventory (старые объявления без активности)
  const now = Date.now();
  const stale = items.filter((i) => {
    const age = (now - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return i.status === 'active' && age > 60 && i.contacts < 3;
  });
  if (stale.length > 0) {
    out.push({
      id: id(),
      priority: 'low',
      type: 'content',
      group: 'Освежить старые объявления',
      title: `${stale.length} объявлений старше 60 дней без откликов`,
      description:
        'По правилам avito-skill: stale inventory нуждается в проверке цены, контента, категории, остатков или доступности до того, как добавлять платное продвижение.',
      expectedEffect: 'Возврат ранжирования и интереса к объявлениям.',
      actionLabel: 'Открыть список',
      status: 'new',
    });
  }

  // ─── Scaling: масштабирование и расширение
  // Когда есть стабильно эффективные объявления (CPL ниже цели, контактов ≥ 5,
  // тренд вверх), и при этом бюджет ещё не выбран — это сигнал к масштабированию.
  // Источник правил: avito-skill `business-scenarios.md` → "Scale Winners".
  const scalable = items.filter((i) => {
    if (i.status !== 'active') return false;
    const cpl = calcCpl(i.spend, i.contacts);
    if (cpl == null) return false;
    return cpl <= kpi.targetCpl && i.contacts >= 5;
  });
  const budgetHeadroom = Math.max(0, kpi.monthlyBudget - stats.totalSpend);
  const budgetHeadroomPercent =
    kpi.monthlyBudget > 0 ? (budgetHeadroom / kpi.monthlyBudget) * 100 : 0;

  if (scalable.length > 0 && budgetHeadroomPercent >= 15) {
    const trimmed = scalable.slice(0, 5);
    const namesPreview = trimmed
      .map((i) => `«${i.title}»`)
      .join(', ');
    const expectedExtraLeads = Math.round(
      trimmed.reduce(
        (acc, i) => acc + (i.contacts > 0 ? Math.min(i.contacts * 0.3, 8) : 0),
        0
      )
    );
    out.push({
      id: id(),
      priority: 'medium',
      type: 'budget',
      group: 'Масштабирование',
      title: `Можно масштабировать ${scalable.length} прибыльных объявлений`,
      description: `У этих объявлений CPL уже ниже цели и стабильный поток обращений: ${namesPreview}${
        scalable.length > trimmed.length ? ' и др.' : ''
      }. Свободный месячный бюджет — ${formatRub(budgetHeadroom)} (${formatPercent(
        budgetHeadroomPercent,
        0
      )}). Поднимите ставку шагами по 10–15% и/или подключите услуги продвижения.`,
      expectedEffect: `Прогноз: +${expectedExtraLeads} лидов в текущем периоде без выхода за бюджет.`,
      actionLabel: 'Посмотреть кандидатов',
      status: 'new',
    });
  }

  // ─── Расширение: гео и категории
  // Если в одной категории/регионе есть «победители», а в смежных нет покрытия —
  // предложим протестировать расширение ассортимента.
  const cats = categoryWinners(items, kpi);
  if (cats.length > 0 && budgetHeadroomPercent >= 20) {
    out.push({
      id: id(),
      priority: 'low',
      type: 'content',
      group: 'Масштабирование',
      title: `Расширьте ассортимент в категории «${cats[0].category}»`,
      description: `В этой категории ${cats[0].winners} объявлений работают в плюс при медиане CPL ${formatRub(
        cats[0].medianCpl ?? 0
      )}. Запустите ещё ${Math.min(3, cats[0].winners)} похожих объявления — это самый дешёвый рост.`,
      expectedEffect: 'Увеличение пула лидов без вложения в более дорогие сегменты.',
      actionLabel: 'Открыть категорию',
      status: 'new',
    });
  }

  // ─── Региональное расширение
  const regionsToExpand = regionExpansionCandidates(items, kpi);
  if (regionsToExpand.length > 0 && budgetHeadroomPercent >= 15) {
    out.push({
      id: id(),
      priority: 'low',
      type: 'account',
      group: 'Масштабирование',
      title: `Протестируйте новые регионы: ${regionsToExpand.slice(0, 2).join(', ')}`,
      description:
        'В этих регионах у вас почти нет активных объявлений, при этом в основных регионах CPL стабильно ниже цели. Безопасный тест: 1–2 объявления на низкой ставке, бюджет ≤ 10% от месячного.',
      expectedEffect: 'Диверсификация источников лидов и снижение зависимости от одного региона.',
      actionLabel: 'Открыть аналитику регионов',
      status: 'new',
    });
  }

  // По объявлениям
  for (const item of items) {
    if (item.status !== 'active') continue;
    const eff = classifyItem(item, kpi);
    const bid = calculateBidRecommendation(item, kpi, metrics, cat);

    if (eff === 'overspend') {
      out.push({
        id: id(),
        itemId: item.id,
        priority: 'high',
        type: 'bid',
        group: 'Снизить перерасход',
        title: `«${item.title}»: снизить ставку на ${Math.abs(bid.diffPercent)}%`,
        description: bid.reason,
        expectedEffect: `Прогноз: расход ~${formatRub(bid.forecastSpend)} (${
          bid.forecastSpendDelta >= 0 ? '+' : ''
        }${formatRub(bid.forecastSpendDelta)}), лидов ~${bid.forecastContacts}.`,
        actionLabel: 'Применить ставку',
        status: 'new',
      });
    } else if (eff === 'effective' && bid.diffPercent > 0) {
      out.push({
        id: id(),
        itemId: item.id,
        priority: 'medium',
        type: 'bid',
        group: 'Масштабирование',
        title: `«${item.title}»: повысить ставку на ${bid.diffPercent}%`,
        description: bid.reason,
        expectedEffect: `Прогноз: расход ~${formatRub(bid.forecastSpend)}, лидов ~${bid.forecastContacts}.`,
        actionLabel: 'Применить ставку',
        status: 'new',
      });
    } else if (eff === 'lowConversion') {
      out.push({
        id: id(),
        itemId: item.id,
        priority: 'medium',
        type: 'content',
        group: 'Исправить слабую конверсию',
        title: `«${item.title}»: проверьте контент`,
        description: bid.reason,
        expectedEffect:
          'Рост конверсии из просмотра в контакт хотя бы до медианы по категории.',
        actionLabel: 'Открыть карточку',
        status: 'new',
      });
    } else if (eff === 'noLeads') {
      out.push({
        id: id(),
        itemId: item.id,
        priority: 'high',
        type: 'bid',
        group: 'Снизить перерасход',
        title: `«${item.title}»: расход без обращений`,
        description: bid.reason,
        expectedEffect: `Экономия ~${formatRub(item.spend)} в следующем периоде.`,
        actionLabel: 'Снизить ставку',
        status: 'new',
      });
    } else if (eff === 'noData') {
      out.push({
        id: id(),
        itemId: item.id,
        priority: 'low',
        type: 'account',
        group: 'Объявления без данных',
        title: `«${item.title}»: накопить статистику`,
        description:
          'Данных пока недостаточно для точных рекомендаций. Подождите 5–7 дней и проверьте показатели снова.',
        expectedEffect: 'Достоверная оценка эффективности и точные рекомендации по ставке.',
        actionLabel: 'Открыть карточку',
        status: 'new',
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out;
}

export function recommendationGroups(recs: Recommendation[]) {
  const map = new Map<string, Recommendation[]>();
  for (const r of recs) {
    const key = r.group ?? 'Прочее';
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return Array.from(map.entries());
}
