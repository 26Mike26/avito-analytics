import type {
  ActionLogEntry,
  AvitoItem,
  IntegrationSettings,
  ItemMetrics,
} from '../types';
import {
  generateMetricsForItems,
  generateMockItems,
} from '../data/mock';
import { parseCsvImport, type CsvImportResult } from '../lib/csvImport';

/** Событие из самого Авито (оригинал без id/userId/source). */
export type AvitoExternalEvent = Omit<
  ActionLogEntry,
  'id' | 'userId' | 'source'
>;

/**
 * Нормализует адрес из Авито: «Санкт-Петербург, ул. Лебедева, 20АБ» → «Санкт-Петербург».
 * Если в строке сразу регион (без «г.» в начале), вернёт его. Пустую → «—».
 */
function normalizeCity(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '—';
  // Берём первый сегмент до запятой
  const first = s.split(',')[0].trim();
  // Чистим распространённые префиксы
  return first.replace(/^г\.?\s*/i, '').trim() || '—';
}

/**
 * Расход аккаунта по дням, не привязанный к конкретному объявлению.
 * kind:
 *  - 'promotion_pool' — пополнение CPA/CPx-аванса, т.е. деньги, ушедшие
 *    на рекламу, но без детализации по объявлению (Avito API не отдаёт
 *    эту детализацию через operations_history — она доступна только в
 *    CSV-выгрузке из Авито Pro Статистики).
 *  - 'account_other' — рассылки, прочие услуги по аккаунту, не реклама.
 *  - 'refund' — сторно/возврат, отрицательная сумма (компенсирует расход).
 */
export type AccountCharge = {
  date: string;
  amount: number;
  description: string;
  kind: 'promotion_pool' | 'account_other' | 'refund';
};

/** Баланс аккаунта в Авито. */
export type AvitoBalance = {
  /** Реальный баланс (рубли, доступные на счёте). */
  real: number;
  /** Бонусные средства. */
  bonus: number;
  /** CPA-аванс — деньги, зарезервированные под целевые действия. */
  advance: number;
  fetchedAt: string;
};

/**
 * Слой интеграции с Avito API.
 *
 * В демо-режиме адаптер использует генерируемые mock-данные.
 * При переключении в режим API часть методов помечена как
 * `TODO: подключить реальный API` — нужно реализовать вызовы публичного
 * Avito API на бэкенде (важно: секреты client_secret и access_token нельзя
 * хранить в открытом виде во фронтенде). Для прототипа допустим режим CSV
 * импорта статистики.
 */
export interface IAvitoAdapter {
  fetchItems(): Promise<AvitoItem[]>;
  fetchMetrics(items: AvitoItem[]): Promise<ItemMetrics[]>;
  updateBid(itemId: string, newBid: number): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /**
   * Регистрирует аккаунт на backend-прокси. Прокси сохранит креды у себя
   * и сможет получать токены OAuth от имени этого Авито-аккаунта.
   * Вызывается автоматически при сохранении настроек и при первом
   * `testConnection`, если аккаунт ещё не зарегистрирован.
   */
  registerOnProxy(): Promise<{ ok: boolean; message: string }>;
  importCsv(text: string): Promise<CsvImportResult>;
  /**
   * Подтянуть журнал событий, произошедших в самом аккаунте Авито
   * (история операций баланса, изменения статуса объявлений, входящие
   * сообщения и т.п.). В демо-режиме возвращаем сгенерированный список,
   * чтобы у пользователя было что посмотреть.
   */
  fetchAvitoEvents(opts?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AvitoExternalEvent[]>;
  /**
   * Подтянуть баланс аккаунта Авито (реальные средства, бонусы и CPA-аванс).
   * Возвращает null, если режим не api или прокси недоступен.
   */
  fetchBalance(): Promise<AvitoBalance | null>;
  /**
   * Подтянуть текущие ставки CPx (цена за целевое действие) по объявлениям.
   * Возвращает Map<itemId → ставка_в_рублях>. В демо-режиме — пустая мапа.
   */
  fetchBids(): Promise<Map<string, number>>;
  /**
   * Подтянуть общие расходы аккаунта (без привязки к объявлению):
   * рассылки, услуги по аккаунту, прочие списания.
   */
  fetchAccountCharges(opts?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AccountCharge[]>;
}

/**
 * Адрес backend-прокси (Express), который умеет ходить в Avito API.
 * Если переменная не задана — режим API не работает (только demo и CSV).
 */
const PROXY_BASE = (import.meta.env?.VITE_AVITO_PROXY_URL ?? '')
  .toString()
  .replace(/\/$/, '');

const AVITO_STATS_LOOKBACK_DAYS = 270;

const STATS_V2_SPEND_METRICS = [
  'allSpending',
  'spending',
  'presenceSpending',
  'promoSpending',
  'restSpending',
  'commission',
  'spendingBonus',
] as const;

const STATS_V2_PROFILE_METRICS = [
  'views',
  'contacts',
  'favorites',
  ...STATS_V2_SPEND_METRICS,
];

type StatsV2SpendByItem = {
  itemId: string;
  views: number;
  contacts: number;
  favorites: number;
  spend: number;
};

/**
 * Универсальный fetch к backend-прокси. Прокидывает accountId / userId
 * в заголовках, чтобы прокси мог использовать креды конкретного аккаунта.
 */
async function proxyFetch<T>(
  path: string,
  init: RequestInit & { accountId?: string; userId?: string } = {}
): Promise<T> {
  if (!PROXY_BASE) {
    throw new Error(
      'VITE_AVITO_PROXY_URL не задан. Запустите backend (npm start в backend/) и добавьте URL в .env.'
    );
  }
  const { accountId, userId, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (accountId) headers.set('X-Avito-Account-Id', accountId);
  if (userId) headers.set('X-Avito-User-Id', userId);
  const res = await fetch(`${PROXY_BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (body as { error?: string; message?: string }).error ??
      (body as { error?: string; message?: string }).message ??
      `Прокси ${res.status}: ${path}`;
    throw new Error(msg);
  }
  return body as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = num(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function pickItemId(row: Record<string, unknown>): string | null {
  const item = asRecord(row.item);
  const dimensions = asRecord(row.dimensions);
  const grouping = asRecord(row.grouping);
  const candidates = [
    row.itemId,
    row.item_id,
    row.avitoId,
    row.avito_id,
    row.id,
    item?.itemId,
    item?.id,
    dimensions?.itemId,
    dimensions?.item_id,
    grouping?.itemId,
    grouping?.item_id,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const id = String(candidate).trim();
    if (id) return id;
  }
  return null;
}

function v2Metric(row: Record<string, unknown>, key: string): unknown {
  const metrics = asRecord(row.metrics);
  const values = asRecord(row.values);
  const data = asRecord(row.data);
  return row[key] ?? metrics?.[key] ?? values?.[key] ?? data?.[key];
}

function extractStatsV2Rows(data: unknown): Record<string, unknown>[] {
  const root = asRecord(data);
  const result = asRecord(root?.result);
  const candidates = [
    result?.groupings,
    result?.items,
    result?.data,
    root?.groupings,
    root?.items,
    root?.data,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.flatMap((row) => {
        const record = asRecord(row);
        return record ? [record] : [];
      });
    }
  }
  return [];
}

export class AvitoAdapter implements IAvitoAdapter {
  constructor(private settings: IntegrationSettings) {}

  /**
   * Был ли последний fetchMetrics успешен через /stats/v2 с per-item spend.
   * Используется UI для отключения CPx-распределения (чтобы не плюсовать второй раз).
   */
  public lastMetricsHadV2Spend = false;

  setSettings(settings: IntegrationSettings) {
    this.settings = settings;
  }

  /**
   * Пробует /stats/v2 профильной аналитики. В отличие от старых счётчиков
   * /stats/v1, здесь расходы приходят в копейках по полям spending /
   * presenceSpending / promoSpending / allSpending.
   */
  private async fetchStatsV2SpendByItem(
    itemIds: number[],
    dateFrom: string,
    dateTo: string
  ): Promise<Map<string, StatsV2SpendByItem>> {
    this.lastMetricsHadV2Spend = false;
    const out = new Map<string, StatsV2SpendByItem>();
    if (!PROXY_BASE) return out;
    try {
      for (let i = 0; i < itemIds.length; i += 200) {
        const slice = itemIds.slice(i, i + 200);
        const data = await proxyFetch<{
          result?: { groupings?: unknown[]; items?: unknown[]; data?: unknown[] };
          _v2_unavailable?: boolean;
          error?: string;
          status?: number;
        }>('/api/stats/items/v2', {
          method: 'POST',
          ...this.headers(),
          body: JSON.stringify({
            dateFrom,
            dateTo,
            itemIds: slice,
            grouping: 'item',
            metrics: STATS_V2_PROFILE_METRICS,
            limit: 1000,
            offset: 0,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        // Backend сообщил что v2 не работает у Avito — без красного в Network
        if (data._v2_unavailable || data.error) {
          console.info(
            '[AvitoAdapter] /stats/v2 недоступен у этого аккаунта/тарифа:',
            data.error ?? `status ${data.status}`
          );
          return out;
        }
        for (const row of extractStatsV2Rows(data)) {
          const itemId = pickItemId(row);
          if (!itemId) continue;
          const componentSpendingKopecks = [
            'presenceSpending',
            'promoSpending',
            'restSpending',
            'commission',
            'spendingBonus',
          ].reduce((sum, key) => sum + num(v2Metric(row, key)), 0);
          const spendingKopecks = firstPositive(
            v2Metric(row, 'allSpending'),
            v2Metric(row, 'spending'),
            componentSpendingKopecks
          );
          const legacySpentRub = firstPositive(v2Metric(row, 'spent'));
          const spend = spendingKopecks > 0
            ? Math.round(spendingKopecks / 100)
            : Math.round(legacySpentRub);
          const prev = out.get(itemId) ?? {
            itemId,
            views: 0,
            contacts: 0,
            favorites: 0,
            spend: 0,
          };
          prev.views += num(v2Metric(row, 'views') ?? v2Metric(row, 'uniqViews'));
          prev.contacts += num(v2Metric(row, 'contacts') ?? v2Metric(row, 'uniqContacts'));
          prev.favorites += num(v2Metric(row, 'favorites') ?? v2Metric(row, 'uniqFavorites'));
          prev.spend += spend;
          out.set(itemId, prev);
        }
      }
      this.lastMetricsHadV2Spend = Array.from(out.values()).some((m) => m.spend > 0);
      return out;
    } catch (e) {
      console.info('[AvitoAdapter] /stats/v2 fallback на v1:', e);
      return out;
    }
  }

  private applyStatsV2Spend(
    metrics: ItemMetrics[],
    v2SpendByItem: Map<string, StatsV2SpendByItem>,
    fallbackDate: string
  ) {
    let applied = 0;
    for (const [itemId, v2] of v2SpendByItem.entries()) {
      if (v2.spend <= 0) continue;
      const rows = metrics.filter((m) => m.itemId === itemId);
      if (rows.length === 0) {
        metrics.push({
          itemId,
          date: fallbackDate,
          views: v2.views,
          contacts: v2.contacts,
          favorites: v2.favorites,
          spend: v2.spend,
          bid: 0,
        });
        applied++;
        continue;
      }
      const weights = rows.map((m) => {
        const activity = m.views + m.contacts * 20 + m.favorites * 5;
        return activity > 0 ? activity : 1;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let allocated = 0;
      rows.forEach((row, index) => {
        const share = index === rows.length - 1
          ? v2.spend - allocated
          : Math.round((v2.spend * weights[index]) / totalWeight);
        row.spend = Math.max(0, share);
        allocated += share;
      });
      applied++;
    }
    if (applied > 0) {
      this.lastMetricsHadV2Spend = true;
      console.info(`[AvitoAdapter] /stats/v2 применил точный расход по ${applied} объявлениям.`);
    }
  }

  private async fetchOperationsHistory(
    dateFrom: string,
    dateTo: string
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    const cursor = new Date(`${dateFrom}T00:00:00Z`);
    const end = new Date(`${dateTo}T23:59:59Z`);
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

    while (cursor <= end) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(cursor);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 6);
      chunkEnd.setUTCHours(23, 59, 59, 999);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());

      const opsData = await proxyFetch<{
        result?: { operations?: Array<Record<string, unknown>> };
        operations?: unknown[];
      }>(
        `/api/account/operations?dateFrom=${encodeURIComponent(
          iso(chunkStart)
        )}&dateTo=${encodeURIComponent(iso(chunkEnd))}`,
        this.headers()
      );
      out.push(
        ...(opsData.result?.operations ??
          (opsData.operations as Array<Record<string, unknown>>) ??
          [])
      );

      cursor.setTime(chunkEnd.getTime());
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
    }

    return out;
  }

  /** Заголовки с идентификаторами аккаунта для прокси. */
  private headers(): { accountId?: string; userId?: string } {
    return {
      accountId: this.settings.userId || undefined,
      userId: this.settings.userId || undefined,
    };
  }

  async fetchItems(): Promise<AvitoItem[]> {
    if (this.settings.mode === 'api') {
      try {
        // Тянем все статусы параллельно: активные + старые + удалённые + заблокированные.
        // Avito API не поддерживает status через запятую — делаем несколько запросов.
        const statuses = ['active', 'old', 'removed', 'blocked'];
        const all: Array<{
          id: number | string;
          title?: string;
          status?: string;
          category?: { name?: string };
          address?: string;
          price?: number;
          url?: string;
        }> = [];
        await Promise.all(
          statuses.map(async (st) => {
            try {
              // Несколько страниц на статус (макс ~500 объявлений на статус — должно хватить)
              for (let page = 1; page <= 5; page++) {
                const data = await proxyFetch<{
                  resources?: unknown[];
                  meta?: { total?: number };
                }>(
                  `/api/items?status=${st}&per_page=100&page=${page}`,
                  this.headers()
                );
                const list = (data.resources ?? []) as typeof all;
                if (list.length === 0) break;
                all.push(...list);
                if (list.length < 100) break; // последняя страница
              }
            } catch (e) {
              console.warn(`[AvitoAdapter] fetchItems status=${st} failed:`, e);
            }
          })
        );
        // Дедупликация по id (на всякий случай)
        const seen = new Set<string>();
        const unique = all.filter((it) => {
          const id = String(it.id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return unique.map((it) => ({
          id: String(it.id),
          title: it.title ?? `Объявление ${it.id}`,
          status:
            it.status === 'removed' ||
            it.status === 'closed' ||
            it.status === 'old'
              ? 'archived'
              : it.status === 'blocked' || it.status === 'rejected'
              ? 'paused'
              : 'active',
          category: it.category?.name ?? 'Без категории',
          region: normalizeCity(it.address),
          price: Number(it.price ?? 0),
          currentBid: 0,
          recommendedBid: 0,
          views: 0,
          contacts: 0,
          favorites: 0,
          spend: 0,
          revenue: undefined,
          createdAt: new Date().toISOString().slice(0, 10),
          url: it.url, // ссылка на сам Авито (для кнопки «Открыть на Авито»)
        }));
      } catch (e) {
        console.warn('[AvitoAdapter] fetchItems API error, fallback на demo:', e);
        return generateMockItems();
      }
    }
    return generateMockItems();
  }

  async fetchMetrics(items: AvitoItem[]): Promise<ItemMetrics[]> {
    if (this.settings.mode === 'api') {
      try {
        const today = new Date();
        const past = new Date(today);
        past.setDate(today.getDate() - AVITO_STATS_LOOKBACK_DAYS);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const itemIds = items
          .map((i) => Number(i.id))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (itemIds.length === 0) {
          console.warn('[AvitoAdapter] fetchMetrics: пустой список itemIds');
          return [];
        }

        // ─── Сначала пробуем v2: он даёт расходы по объявлениям в копейках.
        // Дневные views/contacts/favorites оставляем из v1, чтобы графики не
        // превращались в одну строку totals, а v2 накладываем сверху как расход.
        const v2SpendByItem = await this.fetchStatsV2SpendByItem(
          itemIds,
          fmt(past),
          fmt(today)
        );
        const v2HasSpend = Array.from(v2SpendByItem.values()).some(
          (m) => m.spend > 0
        );

        // Avito API ограничивает запрос размером 200 itemIds — режем на пачки.
        const out: ItemMetrics[] = [];
        for (let i = 0; i < itemIds.length; i += 200) {
          const slice = itemIds.slice(i, i + 200);
          const data = await proxyFetch<{ result?: { items?: unknown[] } }>(
            '/api/stats/items',
            {
              method: 'POST',
              ...this.headers(),
              body: JSON.stringify({
                dateFrom: fmt(past),
                dateTo: fmt(today),
                itemIds: slice,
                // Avito API v1: используем актуальные uniq-поля.
                // Поля «spent» в v1 нет.
                fields: ['uniqViews', 'uniqContacts', 'uniqFavorites'],
                periodGrouping: 'day',
              }),
              headers: { 'Content-Type': 'application/json' },
            }
          );
          const list = (data.result?.items ?? []) as Array<{
            itemId?: number | string;
            stats?: Array<{
              date: string;
              views?: number;
              uniqViews?: number;
              contacts?: number;
              uniqContacts?: number;
              favorites?: number;
              uniqFavorites?: number;
              spent?: number;
            }>;
          }>;
          for (const row of list) {
            const id = String(row.itemId);
            for (const s of row.stats ?? []) {
              out.push({
                itemId: id,
                date: s.date,
                // uniqViews приоритетнее, fallback на views
                views: Number(s.uniqViews ?? s.views ?? 0),
                contacts: Number(s.uniqContacts ?? s.contacts ?? 0),
                favorites: Number(s.uniqFavorites ?? s.favorites ?? 0),
                spend: Number(s.spent ?? 0),
                bid: 0,
              });
            }
          }
        }
        if (out.length === 0) {
          console.warn(
            '[AvitoAdapter] Avito не вернул статистику — возможно, у объявлений ещё нет данных за период, или не включён scope stats:read.'
          );
        }
        // ─── Подтянем расходы из operations_history и распределим по item+date.
        // Avito не отдаёт расходы в /stats/v1/items, но в operations_history
        // у каждого списания за услугу (vas/cpa/cpc/cpx) есть itemId.
        try {
          const ops = await this.fetchOperationsHistory(fmt(past), fmt(today));
          const spendByKey = new Map<string, number>();
          let chargesCount = 0;
          for (const op of ops) {
            const cls = this.classifyOp(op);
            // Per-item расходы и сторно с itemId считаем здесь
            if (cls !== 'charge_per_item' && cls !== 'refund') continue;
            const itemId = op.itemId;
            if (itemId == null) continue; // refund без itemId — не наш случай
            const amount = Number(
              op.amountTotal ?? op.amountRub ?? op.amount ?? 0
            );
            const ts = String(op.updatedAt ?? op.operationDate ?? '');
            if (!ts || amount === 0) continue;
            chargesCount++;
            const date = ts.slice(0, 10);
            const key = `${itemId}|${date}`;
            const sign = cls === 'refund' ? -1 : 1;
            spendByKey.set(
              key,
              (spendByKey.get(key) ?? 0) + sign * Math.abs(amount)
            );
          }
          // Накладываем на out по item+date.
          for (const m of out) {
            const key = `${m.itemId}|${m.date}`;
            const sp = spendByKey.get(key);
            if (sp) m.spend = sp;
          }
          // Если у item были списания, но в out не было записи на эту дату —
          // создадим строку, иначе расход просто потеряется.
          for (const [key, sp] of spendByKey.entries()) {
            const [itemId, date] = key.split('|');
            const exists = out.some(
              (m) => m.itemId === itemId && m.date === date
            );
            if (!exists) {
              out.push({
                itemId,
                date,
                views: 0,
                contacts: 0,
                favorites: 0,
                spend: sp,
                bid: 0,
              });
            }
          }
          if (chargesCount === 0) {
            console.warn(
              '[AvitoAdapter] В operations_history нет операций с itemId за период — расход останется 0.'
            );
          } else {
            console.info(
              `[AvitoAdapter] Подтянуто ${chargesCount} операций с расходами, по ${spendByKey.size} парам item+date.`
            );
          }
        } catch (e) {
          console.warn(
            '[AvitoAdapter] Не удалось подтянуть расходы из operations_history:',
            e
          );
        }
        if (v2HasSpend) {
          this.applyStatsV2Spend(out, v2SpendByItem, fmt(today));
        }
        return out;
      } catch (e) {
        console.warn('[AvitoAdapter] fetchMetrics API error, fallback на demo:', e);
        return generateMetricsForItems(items);
      }
    }
    return generateMetricsForItems(items);
  }

  async updateBid(itemId: string, newBid: number): Promise<void> {
    if (this.settings.mode === 'api') {
      try {
        await proxyFetch('/api/cpx/bids/manual', {
          method: 'POST',
          ...this.headers(),
          body: JSON.stringify({ itemId: Number(itemId), bid: Math.round(newBid) }),
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        console.warn('[AvitoAdapter] updateBid error:', e);
      }
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.settings.mode === 'demo') {
      return { ok: true, message: 'Демо-режим активен. Данные генерируются локально.' };
    }
    if (this.settings.mode === 'csv') {
      return {
        ok: true,
        message: 'Режим CSV. Загрузите выгрузку статистики через форму ниже.',
      };
    }
    if (!PROXY_BASE) {
      return {
        ok: false,
        message:
          'Не задан VITE_AVITO_PROXY_URL. Запустите backend (npm start в backend/) и пропишите URL в .env.',
      };
    }
    if (!this.settings.userId) {
      return {
        ok: false,
        message: 'Заполните Avito User ID — это числовой ID вашего профиля.',
      };
    }
    // 1) Сначала пробуем — может, аккаунт уже зарегистрирован на прокси
    try {
      const r = await proxyFetch<{ ok: boolean; message: string }>(
        '/api/health',
        this.headers()
      );
      return { ok: !!r.ok, message: r.message ?? 'OK' };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // Прокси сообщает «не зарегистрирован» → попробуем зарегистрировать на лету
      // (если у нас есть clientId/clientSecret в настройках)
      const looksLikeNotRegistered = /не зарегистрирован/i.test(errMsg);
      if (
        looksLikeNotRegistered &&
        this.settings.clientId &&
        this.settings.clientSecret
      ) {
        const reg = await this.registerOnProxy();
        if (!reg.ok) return reg;
        // Повторная проверка после регистрации
        try {
          const r = await proxyFetch<{ ok: boolean; message: string }>(
            '/api/health',
            this.headers()
          );
          return { ok: !!r.ok, message: r.message ?? 'OK' };
        } catch (e2) {
          return {
            ok: false,
            message: e2 instanceof Error ? e2.message : String(e2),
          };
        }
      }
      if (looksLikeNotRegistered) {
        return {
          ok: false,
          message:
            'Аккаунт не зарегистрирован на прокси. Заполните Client ID и Client Secret в форме выше и нажмите «Сохранить» — мы зарегистрируем аккаунт автоматически.',
        };
      }
      return { ok: false, message: errMsg };
    }
  }

  async registerOnProxy(): Promise<{ ok: boolean; message: string }> {
    if (!PROXY_BASE) {
      return { ok: false, message: 'VITE_AVITO_PROXY_URL не задан.' };
    }
    if (
      !this.settings.userId ||
      !this.settings.clientId ||
      !this.settings.clientSecret
    ) {
      return {
        ok: false,
        message: 'Нужны User ID, Client ID и Client Secret.',
      };
    }
    try {
      await proxyFetch<{ ok: boolean }>('/api/accounts/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.settings.userId,
          clientId: this.settings.clientId,
          clientSecret: this.settings.clientSecret,
        }),
      });
      return { ok: true, message: `Аккаунт ${this.settings.userId} зарегистрирован на прокси.` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async importCsv(text: string): Promise<CsvImportResult> {
    return parseCsvImport(text);
  }

  /**
   * Классифицирует операцию из operations_history.
   *
   *  - 'charge_per_item'    — расход на конкретное объявление (есть itemId)
   *  - 'charge_promotion_pool' — внесение CPA/CPx-аванса = деньги на рекламу,
   *    но без детализации по объявлениям (см. AccountCharge.kind = 'promotion_pool')
   *  - 'charge_account_other' — рассылки и пр. услуги без рекламной природы
   *  - 'refund'             — сторно/возврат
   *  - 'topup'              — пополнение Авито Кошелька с карты (НЕ расход)
   *  - 'unknown'            — игнорируем
   */
  private classifyOp(op: Record<string, unknown>):
    | 'charge_per_item'
    | 'charge_promotion_pool'
    | 'charge_account_other'
    | 'refund'
    | 'topup'
    | 'unknown' {
    const opType = String(op.operationType ?? '').toLowerCase();
    const opName = String(op.operationName ?? '').toLowerCase();
    const serviceName = String(op.serviceName ?? '').toLowerCase();
    const serviceType = String(op.serviceType ?? '').toLowerCase();
    // Сторно — возврат, вычитается из расхода
    if (opType.includes('сторно')) return 'refund';
    // Пополнение Авито Кошелька — не расход на рекламу
    if (opName.includes('пополнение авито кошелька')) return 'topup';
    if (opName.includes('пополнение кошелька')) return 'topup';
    // Внесение CPA/CPx-аванса = пул на рекламу. Без itemId, но это
    // ИМЕННО реклама, поэтому идёт в promotion_pool, а не в account_other.
    if (
      opType.includes('внесение cpa') ||
      opType.includes('cpa аванс') ||
      opType.includes('cpx') ||
      opName.includes('cpa аванс')
    ) {
      return 'charge_promotion_pool';
    }
    // Услуги VAS на конкретное объявление (XL, Premium, поднятие)
    if (op.itemId != null) return 'charge_per_item';
    // Рассылки и прочие услуги по аккаунту без itemId
    if (
      serviceName.includes('рассылка') ||
      serviceName.includes('mailing') ||
      ['vas', 'mailing'].includes(serviceType)
    ) {
      return 'charge_account_other';
    }
    if (opType.includes('резервирование')) return 'charge_account_other';
    return 'unknown';
  }

  /**
   * Общие расходы аккаунта: рассылки, CPA-авансы, прочее без itemId.
   * Сторно вычитаются (отрицательной записью).
   */
  async fetchAccountCharges(opts?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AccountCharge[]> {
    if (this.settings.mode !== 'api') return [];
    if (!PROXY_BASE) return [];
    try {
      const today = new Date();
      const past = new Date(today);
      past.setDate(today.getDate() - AVITO_STATS_LOOKBACK_DAYS);
      const fromDate = (opts?.dateFrom ?? past.toISOString().slice(0, 10)).slice(0, 10);
      const toDate = (opts?.dateTo ?? today.toISOString().slice(0, 10)).slice(0, 10);
      const ops = await this.fetchOperationsHistory(fromDate, toDate);
      const out: AccountCharge[] = [];
      for (const op of ops) {
        const cls = this.classifyOp(op);
        if (cls === 'unknown' || cls === 'topup') continue;
        if (cls === 'charge_per_item') continue;
        const amount = Number(op.amountTotal ?? op.amountRub ?? op.amount ?? 0);
        const ts = String(op.updatedAt ?? op.operationDate ?? '');
        if (!ts || amount === 0) continue;
        const opName = String(op.operationName ?? '');
        const serviceName = String(op.serviceName ?? '');
        let kind: AccountCharge['kind'];
        if (cls === 'charge_promotion_pool') kind = 'promotion_pool';
        else if (cls === 'refund') kind = 'refund';
        else kind = 'account_other';
        const description =
          cls === 'refund'
            ? `Сторно: ${serviceName || opName || 'услуга'}`
            : cls === 'charge_promotion_pool'
            ? opName || 'Внесение CPA-аванса'
            : opName ||
              (serviceName ? `Услуга: ${serviceName}` : 'Расход аккаунта');
        out.push({
          date: ts.slice(0, 10),
          amount: cls === 'refund' ? -Math.abs(amount) : Math.abs(amount),
          description,
          kind,
        });
      }
      return out;
    } catch (e) {
      console.warn('[AvitoAdapter] fetchAccountCharges error:', e);
      return [];
    }
  }

  /**
   * Тянет CPA-ставки по объявлениям через /cpxpromo/1/bids/get.
   * Возвращает Map<itemId, bid в рублях>. Если у пользователя нет CPA-кампаний
   * или эндпоинт недоступен — возвращает пустую мапу (это нормально).
   */
  async fetchBids(): Promise<Map<string, number>> {
    if (this.settings.mode !== 'api') return new Map();
    if (!PROXY_BASE) return new Map();
    try {
      const data = await proxyFetch<{
        result?: {
          bids?: Array<{ itemId: number | string; bid?: number; manual?: boolean }>;
        };
        bids?: Array<{ itemId: number | string; bid?: number }>;
        _note?: string;
      }>('/api/cpx/bids', this.headers());
      // Backend вернул "CPA не подключён" — это нормально, не пишем warn
      if (data._note) {
        console.info('[AvitoAdapter] fetchBids:', data._note);
        return new Map();
      }
      const bids =
        (data.result?.bids ?? data.bids ?? []) as Array<{
          itemId: number | string;
          bid?: number;
        }>;
      const out = new Map<string, number>();
      for (const b of bids) {
        if (b.itemId == null) continue;
        out.set(String(b.itemId), Number(b.bid ?? 0));
      }
      return out;
    } catch (e) {
      // тихая ошибка — возвращаем пустую мапу, без красного варнинга
      console.info('[AvitoAdapter] fetchBids недоступен:', e);
      return new Map();
    }
  }

  /**
   * Получить баланс аккаунта Avito.
   *  • /api/account/balance     → real + bonus (надёжный источник)
   *  • /api/account/cpa-balance → CPA-баланс (если ручка отдаёт)
   *
   * advance в этом методе = текущий остаток CPA-аванса (если Avito его отдал).
   * Если Avito не отдаёт CPA-баланс — оставляем 0, а на дашборде покажем
   * не остаток, а ИЗМЕНЕНИЕ CPA-аванса за период (пополнения − расход).
   */
  async fetchBalance(): Promise<AvitoBalance | null> {
    if (this.settings.mode !== 'api') return null;
    if (!PROXY_BASE) return null;
    try {
      const [bal, cpa] = await Promise.allSettled([
        proxyFetch<Record<string, unknown>>('/api/account/balance', this.headers()),
        proxyFetch<Record<string, unknown>>(
          '/api/account/cpa-balance',
          this.headers()
        ),
      ]);
      let real = 0;
      let bonus = 0;
      let advance = 0;
      if (bal.status === 'fulfilled') {
        const root =
          (bal.value.result as Record<string, unknown> | undefined) ??
          (bal.value as Record<string, unknown>);
        real = Number(root.real ?? root.realBalance ?? 0);
        bonus = Number(root.bonus ?? root.bonusBalance ?? 0);
      }
      if (cpa.status === 'fulfilled') {
        const root =
          (cpa.value.result as Record<string, unknown> | undefined) ??
          (cpa.value as Record<string, unknown>);
        advance = Number(
          root.advance ?? root.balance ?? root.amount ?? root.cpaBalance ?? 0
        );
      }
      return {
        real,
        bonus,
        advance,
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      console.warn('[AvitoAdapter] fetchBalance error:', e);
      return null;
    }
  }

  /**
   * Демо-генератор событий «как из Авито».
   * При боевом режиме сюда нужно подтянуть реальные источники:
   *   • POST /core/v1/accounts/operations_history/  — операции баланса
   *   • GET  /messenger/v2/accounts/{id}/chats?unread_only=true
   *   • GET  /core/v1/accounts/{id}/calls/stats
   *   • GET  /core/v1/items?status=...  — сравнение со снапшотом для diff
   * см. _api-ref/references/sections/{user,messenger,calltracking}.md
   */
  async fetchAvitoEvents(opts?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AvitoExternalEvent[]> {
    if (this.settings.mode === 'api') {
      try {
        const today = new Date();
        const past = new Date(today);
        past.setDate(today.getDate() - 14);
        const fmt = (d: Date) => d.toISOString();
        const qs = new URLSearchParams({
          dateFrom: opts?.dateFrom ?? fmt(past),
          dateTo: opts?.dateTo ?? fmt(today),
        });
        const data = await proxyFetch<{
          result?: {
            operations?: Array<Record<string, unknown>>;
          };
        }>(`/api/account/operations?${qs.toString()}`, this.headers());
        const ops = data.result?.operations ?? [];
        return ops
          .map((opRaw) => {
            const o = opRaw as Record<string, unknown>;
            const amount = Number(o.amountTotal ?? o.amountRub ?? 0);
            const opType = String(o.operationType ?? '').toLowerCase();
            const opName = String(o.operationName ?? '');
            const serviceName = String(o.serviceName ?? '');
            const ts = String(o.updatedAt ?? '');
            // В Avito суммы всегда положительные. Тип определяется через
            // operationType: «аванс» / «внесение CPA аванса» — пополнение,
            // «резервирование средств под услугу» — списание.
            const isCharge =
              opType.includes('резервирование') ||
              opType.includes('списан') ||
              o.itemId != null;
            return {
              timestamp: ts,
              type: isCharge
                ? ('avito_balance_charge' as const)
                : ('avito_balance_topup' as const),
              title: isCharge
                ? `Списание: ${serviceName || opName || 'продвижение'}`
                : opName || 'Пополнение баланса Авито',
              details: `Сумма: ${amount.toLocaleString('ru-RU')} ₽${
                o.itemId ? ` · объявление ${o.itemId}` : ''
              }`,
            };
          })
          .filter((e) => e.timestamp);
      } catch (e) {
        console.warn(
          '[AvitoAdapter] fetchAvitoEvents API error, fallback на demo:',
          e
        );
      }
    }
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const events: AvitoExternalEvent[] = [];
    const samples: Array<{
      type: AvitoExternalEvent['type'];
      title: string;
      details?: string;
    }> = [
      {
        type: 'avito_balance_topup',
        title: 'Пополнение баланса Авито',
        details: 'Сумма: 15 000 ₽',
      },
      {
        type: 'avito_balance_charge',
        title: 'Списание за продвижение',
        details: 'Объявление поднято в выдаче: «Аренда квартиры на сутки»',
      },
      {
        type: 'avito_message_received',
        title: 'Новое сообщение от покупателя',
        details: 'Чат: «Студия в центре, 35 м²»',
      },
      {
        type: 'avito_call_received',
        title: 'Входящий звонок по объявлению',
        details: 'Объявление: «3-комн. 75 м² в Восточном»',
      },
      {
        type: 'avito_item_published',
        title: 'Объявление опубликовано',
        details: 'Изменение статуса: pending → active',
      },
      {
        type: 'avito_item_archived',
        title: 'Объявление снято с публикации',
        details: 'Снято автоматически по сроку',
      },
      {
        type: 'avito_promotion_applied',
        title: 'Активирована услуга продвижения',
        details: 'Тариф: «XL объявление на 7 дней»',
      },
      {
        type: 'avito_review_received',
        title: 'Получен новый отзыв',
        details: 'Оценка 5/5, текст без замечаний',
      },
    ];
    const from = opts?.dateFrom ? Date.parse(opts.dateFrom) : now - 14 * dayMs;
    const to = opts?.dateTo ? Date.parse(opts.dateTo) : now;
    const span = Math.max(dayMs, to - from);
    for (let i = 0; i < 14; i++) {
      const sample = samples[i % samples.length];
      const ts = new Date(from + Math.random() * span).toISOString();
      events.push({ ...sample, timestamp: ts });
    }
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}
