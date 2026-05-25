import { create } from 'zustand';
import type {
  AccountData,
  AccountKpi,
  AccountPeriodCacheEntry,
  ActionLogEntry,
  ActionSource,
  ActionType,
  AvitoItem,
  BidHistoryEntry,
  IntegrationSettings,
  ItemDailyStat,
  ItemMetrics,
  Recommendation,
  Session,
  User,
} from '../types';
import {
  defaultIntegration,
  defaultKpi,
  generateMetricsForItems,
  generateMockItems,
} from '../data/mock';
import {
  applyBidRecommendationsToItems,
  buildRecommendations,
  calculateBidRecommendation,
} from '../lib/recommendations';
import { isClientUser, visibleAccountIdsForUser } from '../lib/clientAccess';
import { lastNDaysRange } from '../lib/analytics';
import {
  AvitoAdapter,
  type AccountCharge,
  type AvitoBalance,
  type SpendingsBreakdown,
} from '../services/AvitoAdapter';
import { authService } from '../services/AuthService';
import { repository } from '../services/Repository';
import {
  accountDailySpendFromSpendings,
  buildCachedPeriodData,
  itemDailyStatsFromMetrics,
} from '../services/StatsCacheService';
import { SUPABASE_ENABLED } from '../services/supabase';
import {
  clearClientToken,
  loadClientToken,
  loadSharedAccounts,
  loadSharedPeriod,
  readClientTokenFromUrl,
  resolveClientShareToken,
  saveClientToken,
} from '../services/ClientShareService';

const ACCOUNTS_KEY = 'avito-app-accounts';
const ACTIVE_KEY = 'avito-app-active-account';
const LOG_KEY = 'avito-app-action-log';
const ANALYTICS_PERIOD_KEY = 'avito-app-analytics-period';
const PERIOD_CACHE_LIMIT = 4;
const LOCAL_STORAGE_PERIOD_CACHE_LIMIT = 2;

type ReportPeriod = { from: string; to: string };

export type AccountApiSyncResult = {
  accountId: string;
  accountName: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
  items?: number;
};

function genId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Возвращает валидный UUID v4 — нужен для колонок типа uuid в Postgres
 * (accounts.id, bid_history.id, action_log.id).
 * crypto.randomUUID доступен на localhost и https.
 */
function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Фолбэк для очень старых браузеров.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadAccounts(): Record<string, AccountData> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, AccountData>) : {};
  } catch {
    return {};
  }
}
function isStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function compactPeriodCacheToLimit(
  cache: AccountData['periodCache'],
  limit: number
): AccountData['periodCache'] {
  if (!cache || limit <= 0) return undefined;
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, limit);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function compactAccountsForLocalStorage(
  map: Record<string, AccountData>,
  periodLimit: number
): Record<string, AccountData> {
  return Object.fromEntries(
    Object.entries(map).map(([id, account]) => [
      id,
      {
        ...account,
        periodCache: compactPeriodCacheToLimit(account.periodCache, periodLimit),
      },
    ])
  );
}

function lightweightAccountsForLocalStorage(
  map: Record<string, AccountData>
): Record<string, AccountData> {
  return Object.fromEntries(
    Object.entries(map).map(([id, account]) => [
      id,
      {
        ...account,
        // Большие массивы сохраняются в Supabase. В localStorage держим только легкий
        // стартовый слепок, чтобы браузер не падал на лимите 5-10 МБ.
        metrics: [],
        recommendations: [],
        periodCache: undefined,
        accountCharges: (account.accountCharges ?? []).slice(-90),
        spendings: account.spendings
          ? {
              ...account.spendings,
              byDate: account.spendings.byDate.slice(-120),
            }
          : account.spendings,
      },
    ])
  );
}

function supabaseMirrorAccountsForLocalStorage(
  map: Record<string, AccountData>
): Record<string, AccountData> {
  return Object.fromEntries(
    Object.entries(map).map(([id, account]) => [
      id,
      {
        ...account,
        // В Supabase-режиме источником правды остаётся база. В браузере держим
        // только лёгкий индекс аккаунтов без тяжёлой статистики и API-секретов.
        integration: {
          ...account.integration,
          clientSecret: '',
          accessToken: '',
        },
        items: [],
        metrics: [],
        bidHistory: [],
        notes: {},
        recommendations: [],
        periodCache: undefined,
        accountCharges: (account.accountCharges ?? []).slice(-30),
        spendings: account.spendings
          ? {
              ...account.spendings,
              byDate: account.spendings.byDate.slice(-30),
            }
          : account.spendings,
      },
    ])
  );
}

function trySaveAccountsMap(map: Record<string, AccountData>): boolean {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(map));
    return true;
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    return false;
  }
}

function saveAccounts(map: Record<string, AccountData>) {
  if (SUPABASE_ENABLED) {
    if (trySaveAccountsMap(supabaseMirrorAccountsForLocalStorage(map))) return;
    console.warn(
      '[storage] Не удалось сохранить легкое зеркало аккаунтов Supabase в localStorage.'
    );
    return;
  }

  if (trySaveAccountsMap(map)) return;

  const compacted = compactAccountsForLocalStorage(
    map,
    LOCAL_STORAGE_PERIOD_CACHE_LIMIT
  );
  if (trySaveAccountsMap(compacted)) {
    console.warn(
      '[storage] localStorage переполнен: сохранена компактная версия кеша аккаунтов.'
    );
    return;
  }

  const latestOnly = compactAccountsForLocalStorage(map, 1);
  if (trySaveAccountsMap(latestOnly)) {
    console.warn(
      '[storage] localStorage переполнен: сохранён только последний периодный кеш.'
    );
    return;
  }

  const lightweight = lightweightAccountsForLocalStorage(map);
  if (trySaveAccountsMap(lightweight)) {
    console.warn(
      '[storage] localStorage переполнен: сохранена легкая локальная копия, полные данные остаются в Supabase.'
    );
    return;
  }

  console.warn(
    '[storage] Не удалось сохранить аккаунты в localStorage: даже легкая копия превышает лимит браузера.'
  );
}
function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}
function saveActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (error) {
    console.warn('[storage] Не удалось сохранить активный аккаунт:', error);
  }
}
function onlyAvitoLog(entries: ActionLogEntry[]): ActionLogEntry[] {
  return entries.filter((entry) => entry.source === 'avito');
}
function loadLog(): ActionLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? onlyAvitoLog(JSON.parse(raw) as ActionLogEntry[]) : [];
  } catch {
    return [];
  }
}
function saveLog(entries: ActionLogEntry[]) {
  // В журнале оставляем только события Авито и ограничиваем размер.
  const avitoEntries = onlyAvitoLog(entries);
  for (const limit of [5000, 1000, 250, 50]) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(avitoEntries.slice(0, limit)));
      return;
    } catch (error) {
      if (!isStorageQuotaError(error)) {
        console.warn('[storage] Не удалось сохранить журнал действий:', error);
        return;
      }
    }
  }
  console.warn('[storage] Журнал действий не сохранён: localStorage переполнен.');
}
function isValidPeriod(value: unknown): value is ReportPeriod {
  if (!value || typeof value !== 'object') return false;
  const p = value as ReportPeriod;
  return /^\d{4}-\d{2}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}-\d{2}$/.test(p.to);
}
function loadAnalyticsPeriod(): ReportPeriod {
  try {
    const raw = localStorage.getItem(ANALYTICS_PERIOD_KEY);
    if (!raw) return lastNDaysRange(30);
    const parsed = JSON.parse(raw);
    return isValidPeriod(parsed) ? parsed : lastNDaysRange(30);
  } catch {
    return lastNDaysRange(30);
  }
}
function saveAnalyticsPeriod(period: ReportPeriod) {
  try {
    localStorage.setItem(ANALYTICS_PERIOD_KEY, JSON.stringify(period));
  } catch (error) {
    console.warn('[storage] Не удалось сохранить период аналитики:', error);
  }
}

function createDemoAccount(ownerId: string, name: string, seed = 0): AccountData {
  // seed — для разнообразия; пока используем просто разные генерации
  void seed;
  const items = generateMockItems();
  const metrics = generateMetricsForItems(items);
  const kpi = { ...defaultKpi };
  const itemsWithRec = applyBidRecommendationsToItems(items, kpi, metrics);
  const recs = buildRecommendations(itemsWithRec, kpi, metrics);
  return {
    id: genUuid(),
    name,
    ownerId,
    integration: { ...defaultIntegration },
    kpi,
    items: itemsWithRec,
    metrics,
    bidHistory: [],
    notes: {},
    recommendations: recs,
    createdAt: new Date().toISOString(),
    balance: null,
    accountCharges: [],
    hasPerItemSpend: false,
    spendings: null,
  };
}

const adapter = new AvitoAdapter(defaultIntegration);

type Store = {
  // Сессия и пользователи
  session: Session | null;
  currentUser: User | null;
  /** Токен клиентского доступа, если вход выполнен по share-ссылке. */
  clientShareToken: string | null;

  // Аккаунты
  accounts: Record<string, AccountData>;
  currentAccountId: string | null;

  // Лог действий
  actionLog: ActionLogEntry[];

  // ───── «Зеркало» текущего аккаунта (для обратной совместимости со страницами)
  initialized: boolean;
  loading: boolean;
  kpi: AccountKpi;
  items: AvitoItem[];
  metrics: ItemMetrics[];
  recommendations: Recommendation[];
  bidHistory: BidHistoryEntry[];
  notes: Record<string, string>;
  integration: IntegrationSettings;
  adapter: AvitoAdapter;
  /** Баланс активного аккаунта Avito (real / bonus / advance). null — не загружен. */
  balance: AvitoBalance | null;
  /** Общие расходы аккаунта (без привязки к объявлению): рассылки и т.п. */
  accountCharges: AccountCharge[];
  /**
   * true, если последний fetchMetrics получил per-item spend через /stats/v2.
   * Тогда CPx-аванс уже учтён в metrics — не распределяем повторно по показам.
   */
  hasPerItemSpend: boolean;
  /** Точные суммы расхода через /stats/v2/spendings (если ручка доступна). */
  spendings: SpendingsBreakdown | null;
  /** Общий выбранный период для дашборда, аналитики и списка объявлений. */
  analyticsPeriod: ReportPeriod;
  setAnalyticsPeriod: (period: ReportPeriod) => void;

  // ───── Управление сессией
  bootstrap: () => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;

  // ───── Аккаунты
  createAccount: (name: string) => string;
  renameAccount: (id: string, name: string) => void;
  removeAccount: (id: string) => void;
  switchAccount: (id: string) => void;
  syncAllApiAccounts: () => Promise<AccountApiSyncResult[]>;
  hydratePeriodCacheForAccounts: (
    period?: ReportPeriod,
    accountIds?: string[]
  ) => Promise<void>;
  /**
   * Подтягивает точную статистику за период для клиента, вошедшего по
   * share-ссылке (через RPC, без авторизации). Аналог
   * hydratePeriodCacheForAccounts, но источник данных — client_share_period.
   */
  refreshClientSharePeriod: (period?: ReportPeriod) => Promise<void>;

  // ───── KPI / данные / рекомендации (текущий аккаунт)
  init: () => Promise<void>;
  setKpi: (k: AccountKpi) => void;
  recalc: () => void;
  setItemBid: (itemId: string, newBid: number, reason?: string) => void;
  applyRecommendation: (recId: string) => void;
  declineRecommendation: (recId: string) => void;
  postponeRecommendation: (recId: string) => void;
  applyAllBidRecommendations: (limitPercent: number) => number;
  setNote: (itemId: string, text: string) => void;
  updateIntegration: (s: Partial<IntegrationSettings>) => void;
  ensureItemImages: (itemIds: string[]) => Promise<void>;
  saveExactItemDailyStats: (
    rows: ItemDailyStat[],
    period?: ReportPeriod
  ) => Promise<void>;
  reloadFromAdapter: () => Promise<void>;
  applyImportedData: (items: AvitoItem[], metrics: ItemMetrics[]) => void;
  resetToDemo: () => Promise<void>;

  // ───── Лог действий
  log: (
    type: ActionType,
    title: string,
    details?: string,
    extras?: { before?: unknown; after?: unknown; source?: ActionSource }
  ) => void;
  /** Добавить готовые события Авито в журнал (используется при синхронизации). */
  ingestAvitoEvents: (events: Omit<ActionLogEntry, 'id' | 'userId' | 'source'>[]) => void;
  clearLog: () => void;
};

/**
 * Сравнивает два снимка items и возвращает события для журнала действий
 * (источник = 'avito'). Покрывает три кейса:
 *   • новое объявление появилось → avito_item_published
 *   • объявление пропало → avito_item_archived
 *   • изменилась ставка/цена/заголовок → avito_item_edited
 */
function diffItemsToEvents(
  prev: AvitoItem[],
  next: AvitoItem[]
): Array<Omit<ActionLogEntry, 'id' | 'userId' | 'source'>> {
  const out: Array<Omit<ActionLogEntry, 'id' | 'userId' | 'source'>> = [];
  const ts = new Date().toISOString();
  const prevById = new Map(prev.map((p) => [String(p.id), p]));
  const nextById = new Map(next.map((p) => [String(p.id), p]));
  // Новые
  for (const [id, it] of nextById) {
    if (!prevById.has(id)) {
      out.push({
        timestamp: ts,
        type: 'avito_item_published',
        title: `Новое объявление: «${it.title}»`,
        details: `${it.category} · ${it.region}`,
      });
    }
  }
  // Снятые
  for (const [id, it] of prevById) {
    if (!nextById.has(id)) {
      out.push({
        timestamp: ts,
        type: 'avito_item_archived',
        title: `Объявление снято: «${it.title}»`,
        details: `${it.category} · ${it.region}`,
      });
    }
  }
  // Изменённые
  for (const [id, oldIt] of prevById) {
    const newIt = nextById.get(id);
    if (!newIt) continue;
    const changes: string[] = [];
    if (oldIt.currentBid !== newIt.currentBid && newIt.currentBid > 0) {
      changes.push(`ставка ${oldIt.currentBid} → ${newIt.currentBid} ₽`);
    }
    if (oldIt.price !== newIt.price && newIt.price > 0) {
      changes.push(`цена ${oldIt.price} → ${newIt.price} ₽`);
    }
    if (oldIt.title !== newIt.title) {
      changes.push(`заголовок изменён`);
    }
    if (oldIt.status !== newIt.status) {
      changes.push(`статус ${oldIt.status} → ${newIt.status}`);
    }
    if (changes.length > 0) {
      out.push({
        timestamp: ts,
        type: 'avito_item_edited',
        title: `«${newIt.title}»: ${changes.join(', ')}`,
        details: `Объявление ${id}`,
        before: { currentBid: oldIt.currentBid, price: oldIt.price, status: oldIt.status, title: oldIt.title },
        after: { currentBid: newIt.currentBid, price: newIt.price, status: newIt.status, title: newIt.title },
      });
    }
  }
  return out;
}

function buildMirror(acc: AccountData) {
  return {
    items: acc.items,
    metrics: acc.metrics,
    recommendations: acc.recommendations,
    bidHistory: acc.bidHistory,
    notes: acc.notes,
    integration: acc.integration,
    kpi: acc.kpi,
    balance: acc.balance ?? null,
    accountCharges: acc.accountCharges ?? [],
    hasPerItemSpend: acc.hasPerItemSpend ?? false,
    spendings: acc.spendings ?? null,
  };
}

function periodCacheKey(period: ReportPeriod): string {
  return period.from + ':' + period.to;
}

function compactPeriodCache(
  cache: Record<string, AccountPeriodCacheEntry>
): Record<string, AccountPeriodCacheEntry> {
  return (compactPeriodCacheToLimit(cache, PERIOD_CACHE_LIMIT) ?? {}) as Record<
    string,
    AccountPeriodCacheEntry
  >;
}

function withPeriodSnapshot(acc: AccountData, period: ReportPeriod): AccountData {
  const key = periodCacheKey(period);
  const snapshot: AccountPeriodCacheEntry = {
    from: period.from,
    to: period.to,
    savedAt: new Date().toISOString(),
    items: acc.items,
    metrics: acc.metrics,
    recommendations: acc.recommendations,
    accountCharges: acc.accountCharges ?? [],
    hasPerItemSpend: acc.hasPerItemSpend ?? false,
    spendings: acc.spendings ?? null,
  };
  return {
    ...acc,
    periodCache: compactPeriodCache({ ...(acc.periodCache ?? {}), [key]: snapshot }),
  };
}

function withPeriodSnapshotData(
  acc: AccountData,
  period: ReportPeriod,
  snapshot: Omit<AccountPeriodCacheEntry, 'from' | 'to' | 'savedAt'>
): AccountData {
  const key = periodCacheKey(period);
  return {
    ...acc,
    periodCache: compactPeriodCache({
      ...(acc.periodCache ?? {}),
      [key]: {
        from: period.from,
        to: period.to,
        savedAt: new Date().toISOString(),
        ...snapshot,
      },
    }),
  };
}

function buildMirrorForPeriod(acc: AccountData, period: ReportPeriod) {
  const snapshot = acc.periodCache?.[periodCacheKey(period)];
  if (!snapshot) return buildMirror(acc);
  return {
    ...buildMirror(acc),
    items: snapshot.items,
    metrics: snapshot.metrics,
    recommendations: snapshot.recommendations,
    accountCharges: snapshot.accountCharges ?? acc.accountCharges ?? [],
    hasPerItemSpend: snapshot.hasPerItemSpend ?? acc.hasPerItemSpend ?? false,
    spendings: snapshot.spendings ?? acc.spendings ?? null,
  };
}

async function hydrateAccountPeriodFromDailyCache(
  acc: AccountData,
  period: ReportPeriod
): Promise<AccountData | null> {
  if (!SUPABASE_ENABLED) return null;
  const [itemRows, spendRows] = await Promise.all([
    repository.loadItemDailyStats(acc.id, period.from, period.to),
    repository.loadAccountDailySpend(acc.id, period.from, period.to),
  ]);
  const cached = buildCachedPeriodData(acc, itemRows, spendRows, period);
  if (!cached || cached.metrics.length === 0) return null;
  const itemsWithRec = applyBidRecommendationsToItems(
    cached.items,
    acc.kpi,
    cached.metrics
  );
  const recs = buildRecommendations(itemsWithRec, acc.kpi, cached.metrics);
  return withPeriodSnapshotData(acc, period, {
    items: itemsWithRec,
    metrics: cached.metrics,
    recommendations: recs,
    accountCharges: acc.accountCharges ?? [],
    hasPerItemSpend: cached.hasPerItemSpend,
    spendings: cached.spendings,
  });
}

function enrichItemsFromMetrics(items: AvitoItem[], metrics: ItemMetrics[]): AvitoItem[] {
  return items.map((it) => {
    const itemMetrics = metrics.filter((m) => m.itemId === it.id);
    if (itemMetrics.length === 0) return it;
    const sum = itemMetrics.reduce(
      (acc, m) => ({
        views: acc.views + m.views,
        impressions: acc.impressions + (m.impressions ?? 0),
        contacts: acc.contacts + m.contacts,
        favorites: acc.favorites + m.favorites,
        spend: acc.spend + m.spend,
      }),
      { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 }
    );
    return {
      ...it,
      views: it.views || sum.views,
      impressions: it.impressions || sum.impressions || undefined,
      contacts: it.contacts || sum.contacts,
      favorites: it.favorites || sum.favorites,
      spend: it.spend || sum.spend,
    };
  });
}

export const useStore = create<Store>((set, get) => {
  const persistedAccounts = loadAccounts();
  const persistedActive = loadActiveId();
  const persistedLog = loadLog();
  const persistedAnalyticsPeriod = loadAnalyticsPeriod();

  return {
    session: null,
    currentUser: null,
    clientShareToken: null,
    accounts: persistedAccounts,
    currentAccountId: persistedActive,
    actionLog: persistedLog,

    initialized: false,
    loading: false,
    kpi: defaultKpi,
    items: [],
    metrics: [],
    recommendations: [],
    bidHistory: [],
    notes: {},
    integration: defaultIntegration,
    adapter,
    balance: null,
    accountCharges: [],
    hasPerItemSpend: false,
    spendings: null,
    analyticsPeriod: persistedAnalyticsPeriod,
    setAnalyticsPeriod: (period) => {
      saveAnalyticsPeriod(period);
      const id = get().currentAccountId;
      const acc = id ? get().accounts[id] : null;
      set({
        analyticsPeriod: period,
        ...(acc ? buildMirrorForPeriod(acc, period) : {}),
      });
      // Клиент по share-ссылке: точные данные за период берём через RPC.
      if (get().clientShareToken) {
        void get().refreshClientSharePeriod(period);
        return;
      }
      if (!id || !acc || !SUPABASE_ENABLED) return;
      void (async () => {
        try {
          const latest = get().accounts[id];
          if (!latest || get().currentAccountId !== id) return;
          const updated = await hydrateAccountPeriodFromDailyCache(latest, period);
          if (!updated) return;
          const nextAccs = { ...get().accounts, [id]: updated };
          saveAccounts(nextAccs);
          set({
            accounts: nextAccs,
            ...(get().currentAccountId === id &&
            get().analyticsPeriod.from === period.from &&
            get().analyticsPeriod.to === period.to
              ? buildMirrorForPeriod(updated, period)
              : {}),
          });
        } catch (e) {
          console.warn('[stats-cache] load period:', e);
        }
      })();
    },

    bootstrap: async () => {
      const current = get();
      if (current.initialized && current.session && current.currentUser) {
        return;
      }

      // ─── Вход клиента по токен-ссылке ───
      // Резолвит доступ-токен, собирает синтетическую клиентскую сессию
      // (без логина) и наполняет стор аккаунтами доступа. Возвращает true,
      // если токен валиден и сессия установлена.
      const applyClientToken = async (token: string): Promise<boolean> => {
        let share;
        try {
          share = await resolveClientShareToken(token);
        } catch {
          share = null;
        }
        if (!share) {
          clearClientToken();
          return false;
        }
        let sharedAccounts: AccountData[];
        if (SUPABASE_ENABLED) {
          const remote = await loadSharedAccounts(token).catch(() => null);
          sharedAccounts = remote ?? [];
        } else {
          const all = loadAccounts();
          sharedAccounts = share.accountIds
            .map((id) => all[id])
            .filter(Boolean) as AccountData[];
        }
        if (sharedAccounts.length === 0) return false;
        const accs: Record<string, AccountData> = {};
        for (const a of sharedAccounts) accs[a.id] = a;
        const accountIds = sharedAccounts.map((a) => a.id);
        const activeId = accountIds[0] ?? null;
        const acc = activeId ? accs[activeId] : null;
        saveClientToken(token);
        const clientUser: User = {
          id: `share:${share.id}`,
          email: '',
          name: share.label,
          role: 'client',
          passwordHash: '',
          passwordSalt: '',
          createdAt: share.createdAt,
          accountIds,
          clientAccountIds: accountIds,
        };
        set({
          session: {
            userId: clientUser.id,
            startedAt: new Date().toISOString(),
          },
          currentUser: clientUser,
          clientShareToken: token,
          accounts: accs,
          currentAccountId: activeId,
          actionLog: [],
          ...(acc ? buildMirrorForPeriod(acc, get().analyticsPeriod) : {}),
          initialized: true,
        });
        if (acc) adapter.setSettings(acc.integration);
        // Точная статистика за текущий период — через RPC client_share_period.
        await get().refreshClientSharePeriod(get().analyticsPeriod);
        return true;
      };

      // Токен в URL (?ct=...) имеет приоритет над обычной авторизацией.
      const urlToken = readClientTokenFromUrl();
      if (urlToken && (await applyClientToken(urlToken))) {
        return;
      }

      // ─── Supabase режим ───
      if (SUPABASE_ENABLED) {
        const user = await authService.getCurrentUser();
        if (!user) {
          const storedToken = loadClientToken();
          if (storedToken && (await applyClientToken(storedToken))) {
            return;
          }
          set({ session: null, currentUser: null });
          return;
        }
        clearClientToken();
        const session: Session = { userId: user.id, startedAt: new Date().toISOString() };
        const remoteAccounts = await repository.loadUserAccounts(user.id);
        let accs: Record<string, AccountData> = {};
        const cachedAccounts = loadAccounts();
        for (const a of remoteAccounts) {
          const cached = cachedAccounts[a.id];
          accs[a.id] = {
            ...a,
            balance: a.balance ?? cached?.balance ?? null,
            accountCharges: a.accountCharges ?? cached?.accountCharges ?? [],
            hasPerItemSpend: a.hasPerItemSpend ?? cached?.hasPerItemSpend ?? false,
            spendings: a.spendings ?? cached?.spendings ?? null,
            periodCache: a.periodCache ?? cached?.periodCache ?? {},
          };
        }
        let accountIds = remoteAccounts.map((a) => a.id);
        const ownedAccountIds = remoteAccounts
          .filter((a) => a.ownerId === user.id)
          .map((a) => a.id);
        const linkedClientAccountIds = remoteAccounts
          .filter((a) => a.ownerId !== user.id)
          .map((a) => a.id);
        const inferredClientMode =
          isClientUser(user) ||
          (ownedAccountIds.length === 0 && linkedClientAccountIds.length > 0);

        if (accountIds.length === 0 && !inferredClientMode) {
          // Первый вход — создаём стартовый демо-аккаунт и сохраняем в БД
          const demo = createDemoAccount(user.id, 'Демо-аккаунт');
          await repository.saveAccount(demo);
          await repository.saveItems(demo.id, demo.items);
          await repository.saveMetrics(demo.id, demo.metrics);
          await repository.saveAccountCache(demo.id, demo);
          accs = { [demo.id]: demo };
          accountIds = [demo.id];
        }
        const remoteLog = onlyAvitoLog(
          await repository.loadActionLog(user.id, accountIds).catch(() => [])
        );
        const persistedActive = loadActiveId();
        const activeId =
          persistedActive && accountIds.includes(persistedActive)
            ? persistedActive
            : accountIds[0] ?? null;
        const acc = activeId ? accs[activeId] : null;
        saveActiveId(activeId);
        saveAccounts(accs);
        set({
          session,
          currentUser: {
            ...user,
            role: inferredClientMode ? 'client' : user.role ?? 'admin',
            accountIds,
            clientAccountIds: inferredClientMode
              ? linkedClientAccountIds.length > 0
                ? linkedClientAccountIds
                : accountIds
              : user.clientAccountIds ?? [],
          },
          accounts: accs,
          currentAccountId: activeId,
          actionLog: remoteLog,
          ...(acc ? buildMirrorForPeriod(acc, get().analyticsPeriod) : {}),
          initialized: true,
        });
        if (acc) adapter.setSettings(acc.integration);
        get().setAnalyticsPeriod(get().analyticsPeriod);
        return;
      }

      // ─── Локальный режим (как было) ───
      const session = authService.loadSession();
      if (!session) {
        const storedToken = loadClientToken();
        if (storedToken && (await applyClientToken(storedToken))) {
          return;
        }
        set({ session: null, currentUser: null });
        return;
      }
      clearClientToken();
      const users = authService.loadUsers();
      const user = users.find((u) => u.id === session.userId) ?? null;
      if (!user) {
        await authService.logout();
        set({ session: null, currentUser: null });
        return;
      }
      set({ session, currentUser: user });

      const userAccounts = user.accountIds
        .map((id) => get().accounts[id])
        .filter(Boolean) as AccountData[];

      let activeId = get().currentAccountId;
      if (!activeId || !userAccounts.find((a) => a.id === activeId)) {
        if (userAccounts.length === 0) {
          const demo = createDemoAccount(user.id, 'Демо-аккаунт');
          const accs = { ...get().accounts, [demo.id]: demo };
          const updatedUser = { ...user, accountIds: [...user.accountIds, demo.id] };
          authService.updateUser(updatedUser);
          saveAccounts(accs);
          set({ accounts: accs, currentUser: updatedUser });
          activeId = demo.id;
        } else {
          activeId = userAccounts[0].id;
        }
        saveActiveId(activeId);
        set({ currentAccountId: activeId });
      }

      const acc = get().accounts[activeId];
      if (acc) {
        set({ ...buildMirrorForPeriod(acc, get().analyticsPeriod), initialized: true });
        adapter.setSettings(acc.integration);
      }
    },

    signup: async (email, password, name) => {
      await authService.signup(email, password, name);
      if (SUPABASE_ENABLED) {
        // в supabase signup может потребовать подтверждение email — попробуем сразу залогиниться
        try {
          await authService.login(email, password);
        } catch {
          throw new Error(
            'Регистрация прошла, но требуется подтверждение email. Проверьте почту и затем войдите.'
          );
        }
        await get().bootstrap();
        get().log('signup', 'Регистрация нового пользователя', email);
        return;
      }

      // ─── Локальный режим
      const user = (await authService.getCurrentUser())!;
      const demo = createDemoAccount(user.id, 'Демо-аккаунт');
      const accs = { ...get().accounts, [demo.id]: demo };
      const updatedUser = { ...user, accountIds: [demo.id] };
      authService.updateUser(updatedUser);
      saveAccounts(accs);
      await authService.login(email, password);
      const session = authService.loadSession();
      set({
        accounts: accs,
        currentAccountId: demo.id,
        session,
        currentUser: updatedUser,
        ...buildMirror(demo),
        initialized: true,
      });
      saveActiveId(demo.id);
      get().log('signup', 'Регистрация нового пользователя', email);
    },

    login: async (email, password) => {
      await authService.login(email, password);
      if (SUPABASE_ENABLED) {
        await get().bootstrap();
        get().log('login', 'Вход в систему', email);
        return;
      }

      // ─── Локальный режим
      const user = (await authService.getCurrentUser())!;
      const session = authService.loadSession();
      set({ session, currentUser: user });
      const userAccounts = user.accountIds
        .map((id) => get().accounts[id])
        .filter(Boolean) as AccountData[];
      let activeId = userAccounts[0]?.id ?? null;
      if (!activeId) {
        const demo = createDemoAccount(user.id, 'Демо-аккаунт');
        const accs = { ...get().accounts, [demo.id]: demo };
        const updated = { ...user, accountIds: [demo.id] };
        authService.updateUser(updated);
        saveAccounts(accs);
        set({ accounts: accs, currentUser: updated });
        activeId = demo.id;
      }
      saveActiveId(activeId);
      const acc = get().accounts[activeId];
      set({
        currentAccountId: activeId,
        ...buildMirrorForPeriod(acc, get().analyticsPeriod),
        initialized: true,
      });
      adapter.setSettings(acc.integration);
      get().log('login', 'Вход в систему', email);
    },

    logout: () => {
      const email = get().currentUser?.email ?? '';
      get().log('logout', 'Выход из системы', email);
      void authService.logout();
      clearClientToken();
      set({
        session: null,
        currentUser: null,
        clientShareToken: null,
        currentAccountId: null,
        initialized: false,
        items: [],
        metrics: [],
        recommendations: [],
        bidHistory: [],
        notes: {},
      });
      saveActiveId(null);
    },

    createAccount: (name) => {
      const user = get().currentUser;
      if (!user) throw new Error('Нет активной сессии');
      if (isClientUser(user)) throw new Error('Клиентский доступ не может создавать аккаунты.');
      const acc = createDemoAccount(user.id, name || `Аккаунт ${user.accountIds.length + 1}`);
      const accs = { ...get().accounts, [acc.id]: acc };
      const updatedUser = { ...user, accountIds: [...user.accountIds, acc.id] };
      authService.updateUser(updatedUser);
      saveAccounts(accs);
      set({ accounts: accs, currentUser: updatedUser });
      // ─── persist в Supabase
      void (async () => {
        try {
          await repository.saveAccount(acc);
          await repository.saveItems(acc.id, acc.items);
          await repository.saveMetrics(acc.id, acc.metrics);
          await repository.saveAccountCache(acc.id, acc);
        } catch (e) {
          console.warn('[supabase] createAccount persist failed:', e);
        }
      })();
      get().log('account_created', `Создан аккаунт «${acc.name}»`, undefined, {
        after: { id: acc.id, name: acc.name },
      });
      return acc.id;
    },

    renameAccount: (id, name) => {
      const acc = get().accounts[id];
      if (!acc) return;
      const before = acc.name;
      const updated = { ...acc, name };
      const accs = { ...get().accounts, [id]: updated };
      saveAccounts(accs);
      set({ accounts: accs });
      void repository.saveAccount(updated).catch((e) =>
        console.warn('[supabase] renameAccount:', e)
      );
      get().log('account_renamed', `Аккаунт переименован: «${before}» → «${name}»`, undefined, {
        before: { name: before },
        after: { name },
      });
    },

    removeAccount: (id) => {
      const user = get().currentUser;
      if (!user) return;
      const acc = get().accounts[id];
      if (!acc) return;
      const accs = { ...get().accounts };
      delete accs[id];
      const updatedUser = {
        ...user,
        accountIds: user.accountIds.filter((x) => x !== id),
      };
      authService.updateUser(updatedUser);
      saveAccounts(accs);
      let activeId = get().currentAccountId;
      if (activeId === id) {
        activeId = updatedUser.accountIds[0] ?? null;
        saveActiveId(activeId);
      }
      const next = activeId ? accs[activeId] : null;
      set({
        accounts: accs,
        currentUser: updatedUser,
        currentAccountId: activeId,
        ...(next
          ? buildMirrorForPeriod(next, get().analyticsPeriod)
          : {
              items: [],
              metrics: [],
              recommendations: [],
              bidHistory: [],
              balance: null,
              accountCharges: [],
              hasPerItemSpend: false,
              spendings: null,
            }),
      });
      if (next) adapter.setSettings(next.integration);
      void repository.deleteAccount(id).catch((e) =>
        console.warn('[supabase] removeAccount:', e)
      );
      get().log('account_removed', `Удалён аккаунт «${acc.name}»`, undefined, {
        before: { id, name: acc.name },
      });
    },

    switchAccount: (id) => {
      const acc = get().accounts[id];
      if (!acc) return;
      saveActiveId(id);
      set({
        currentAccountId: id,
        ...buildMirrorForPeriod(acc, get().analyticsPeriod),
        initialized: true,
      });
      adapter.setSettings(acc.integration);
      get().log('account_switched', `Переключение на аккаунт «${acc.name}»`);
      get().setAnalyticsPeriod(get().analyticsPeriod);
    },

    syncAllApiAccounts: async () => {
      const user = get().currentUser;
      if (!user) return [];
      const results: AccountApiSyncResult[] = [];
      const accountIds = visibleAccountIdsForUser(user, get().accounts);
      const apiAccountIds = accountIds.filter((id) => {
        const acc = get().accounts[id];
        return acc?.integration.mode === 'api';
      });

      if (apiAccountIds.length === 0) {
        return accountIds
          .map((id) => get().accounts[id])
          .filter(Boolean)
          .map((acc) => ({
            accountId: acc.id,
            accountName: acc.name,
            status: 'skipped' as const,
            message: 'Аккаунт не в режиме API.',
          }));
      }

      set({ loading: true });
      const syncPeriod = get().analyticsPeriod;

      for (const id of apiAccountIds) {
        const accAtStart = get().accounts[id];
        if (!accAtStart) continue;
        const scopedAdapter = new AvitoAdapter(accAtStart.integration);

        try {
          const test = await scopedAdapter.testConnection();
          if (!test.ok) {
            results.push({
              accountId: id,
              accountName: accAtStart.name,
              status: 'error',
              message: test.message,
            });
            continue;
          }

          const prevItems = accAtStart.items;
          const items = await scopedAdapter.fetchItems();

          try {
            const numericIds = items
              .map((i) => Number(i.id))
              .filter((n) => Number.isFinite(n) && n > 0);
            const bids = await scopedAdapter.fetchBids(numericIds);
            if (bids.size > 0) {
              for (const it of items) {
                const b = bids.get(String(it.id));
                if (b && b > 0) it.currentBid = b;
              }
            }
          } catch (e) {
            console.warn('[adapter] bulk fetchBids failed:', e);
          }

          const metrics = await scopedAdapter.fetchMetrics(items, {
            dateFrom: syncPeriod.from,
            dateTo: syncPeriod.to,
          });
          const nextHasPerItemSpend = !!scopedAdapter.lastMetricsHadV2Spend;

          try {
            const events = await scopedAdapter.fetchAvitoEvents();
            if (events.length > 0) {
              get().ingestAvitoEvents(events.map((ev) => ({ ...ev, accountId: id })));
            }
          } catch (e) {
            console.warn('[adapter] bulk fetchAvitoEvents failed:', e);
          }

          try {
            if (prevItems.length > 0) {
              const diffEvents = diffItemsToEvents(prevItems, items);
              if (diffEvents.length > 0) {
                get().ingestAvitoEvents(diffEvents.map((ev) => ({ ...ev, accountId: id })));
              }
            }
          } catch (e) {
            console.warn('[adapter] bulk diffItemsToEvents failed:', e);
          }

          let nextBalance = accAtStart.balance ?? null;
          try {
            const balance = await scopedAdapter.fetchBalance();
            if (balance) nextBalance = balance;
          } catch (e) {
            console.warn('[adapter] bulk fetchBalance failed:', e);
          }

          let nextAccountCharges = accAtStart.accountCharges ?? [];
          try {
            nextAccountCharges = await scopedAdapter.fetchAccountCharges();
          } catch (e) {
            console.warn('[adapter] bulk fetchAccountCharges failed:', e);
          }

          let nextSpendings = accAtStart.spendings ?? null;
          try {
            const sp = await scopedAdapter.fetchSpendings({
              dateFrom: syncPeriod.from,
              dateTo: syncPeriod.to,
            });
            if (sp) nextSpendings = sp;
          } catch (e) {
            console.warn('[adapter] bulk fetchSpendings failed:', e);
          }

          const currentAccs = get().accounts;
          const acc = currentAccs[id];
          if (!acc) continue;
          const enrichedItems = enrichItemsFromMetrics(items, metrics);
          const itemsWithRec = applyBidRecommendationsToItems(enrichedItems, acc.kpi, metrics);
          const recs = buildRecommendations(itemsWithRec, acc.kpi, metrics);
          const updated: AccountData = {
            ...acc,
            items: itemsWithRec,
            metrics,
            recommendations: recs,
            integration: { ...acc.integration, lastSyncAt: new Date().toISOString() },
            balance: nextBalance,
            accountCharges: nextAccountCharges,
            hasPerItemSpend: nextHasPerItemSpend,
            spendings: nextSpendings,
          };
          const updatedWithCache = withPeriodSnapshot(updated, syncPeriod);
          const nextAccs = { ...currentAccs, [id]: updatedWithCache };
          saveAccounts(nextAccs);
          set({
            accounts: nextAccs,
            ...(get().currentAccountId === id
              ? buildMirrorForPeriod(updatedWithCache, get().analyticsPeriod)
              : {}),
          });

          void (async () => {
            try {
              await repository.saveItems(id, itemsWithRec);
              await repository.saveMetrics(id, metrics);
              await repository.saveItemDailyStats(
                id,
                itemDailyStatsFromMetrics(
                  id,
                  metrics,
                  nextHasPerItemSpend ? 'exact' : 'partial'
                )
              );
              await repository.saveAccountDailySpend(
                id,
                accountDailySpendFromSpendings(id, nextSpendings)
              );
              await repository.saveIntegration(id, updatedWithCache.integration);
              await repository.saveAccountCache(id, updatedWithCache);
            } catch (e) {
              console.warn('[supabase] syncAllApiAccounts:', e);
            }
          })();

          results.push({
            accountId: id,
            accountName: updatedWithCache.name,
            status: 'success',
            message: 'Подключение работает, данные обновлены.',
            items: itemsWithRec.length,
          });
        } catch (e) {
          results.push({
            accountId: id,
            accountName: accAtStart.name,
            status: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      set({ loading: false });
      const ok = results.filter((r) => r.status === 'success').length;
      const bad = results.filter((r) => r.status === 'error').length;
      get().log(
        'data_reloaded',
        `Массовая синхронизация API-аккаунтов: успешно ${ok}, ошибок ${bad}`
      );
      return results;
    },

    hydratePeriodCacheForAccounts: async (periodArg, accountIdsArg) => {
      if (!SUPABASE_ENABLED) return;
      const period = periodArg ?? get().analyticsPeriod;
      const ids =
        accountIdsArg ??
        get().currentUser?.accountIds ??
        Object.keys(get().accounts);
      if (ids.length === 0) return;

      const nextAccs = { ...get().accounts };
      let changed = false;
      for (const id of ids) {
        const acc = nextAccs[id];
        if (!acc) continue;
        try {
          const updated = await hydrateAccountPeriodFromDailyCache(acc, period);
          if (!updated) continue;
          nextAccs[id] = updated;
          changed = true;
        } catch (e) {
          console.warn('[stats-cache] hydrate account period:', e);
        }
      }
      if (!changed) return;

      saveAccounts(nextAccs);
      const activeId = get().currentAccountId;
      const active = activeId ? nextAccs[activeId] : null;
      set({
        accounts: nextAccs,
        ...(active ? buildMirrorForPeriod(active, get().analyticsPeriod) : {}),
      });
    },

    refreshClientSharePeriod: async (periodArg) => {
      const token = get().clientShareToken;
      if (!token || !SUPABASE_ENABLED) return;
      const period = periodArg ?? get().analyticsPeriod;
      set({ loading: true });
      try {
        const rows = await loadSharedPeriod(token, period.from, period.to);
        if (!rows || rows.length === 0) return;
        const nextAccs = { ...get().accounts };
        let changed = false;
        for (const row of rows) {
          const acc = nextAccs[row.accountId];
          if (!acc) continue;
          const cached = buildCachedPeriodData(
            acc,
            row.itemDailyStats ?? [],
            row.accountDailySpend ?? [],
            period
          );
          if (!cached || cached.metrics.length === 0) continue;
          const itemsWithRec = applyBidRecommendationsToItems(
            cached.items,
            acc.kpi,
            cached.metrics
          );
          const recs = buildRecommendations(itemsWithRec, acc.kpi, cached.metrics);
          nextAccs[row.accountId] = withPeriodSnapshotData(acc, period, {
            items: itemsWithRec,
            metrics: cached.metrics,
            recommendations: recs,
            accountCharges: acc.accountCharges ?? [],
            hasPerItemSpend: cached.hasPerItemSpend,
            spendings: cached.spendings,
          });
          changed = true;
        }
        if (!changed) return;
        const activeId = get().currentAccountId;
        const active = activeId ? nextAccs[activeId] : null;
        set({
          accounts: nextAccs,
          ...(active ? buildMirrorForPeriod(active, get().analyticsPeriod) : {}),
        });
      } catch (e) {
        console.warn('[client-share] refreshClientSharePeriod:', e);
      } finally {
        set({ loading: false });
      }
    },

    init: async () => {
      // Если уже есть активный аккаунт у залогиненного пользователя — данные уже подняты
      if (!get().session) return;
      if (get().initialized) return;
      const id = get().currentAccountId;
      if (!id) return;
      const acc = get().accounts[id];
      if (acc) {
        set({ ...buildMirrorForPeriod(acc, get().analyticsPeriod), initialized: true });
        adapter.setSettings(acc.integration);
      }
    },

    ensureItemImages: async (itemIds) => {
      const id = get().currentAccountId;
      if (!id) return;
      const acc = get().accounts[id];
      if (!acc || acc.integration.mode !== 'api') return;
      const uniqueIds = Array.from(new Set(itemIds.map(String).filter(Boolean)));
      const missingItems = acc.items
        .filter((it) => uniqueIds.includes(String(it.id)) && !it.imageUrl)
        .map((it) => ({ id: it.id, url: it.url }));
      if (missingItems.length === 0) return;

      const scopedAdapter = new AvitoAdapter(acc.integration);
      const images = await scopedAdapter.fetchItemImages(missingItems);
      if (images.size === 0) return;

      const accs = { ...get().accounts };
      const current = accs[id];
      if (!current) return;
      const updatedItems = current.items.map((it) => {
        if (it.imageUrl) return it;
        const imageUrl = images.get(String(it.id));
        return imageUrl ? { ...it, imageUrl } : it;
      });
      const changed = updatedItems.some((it, index) => it.imageUrl !== current.items[index]?.imageUrl);
      if (!changed) return;

      const updated = { ...current, items: updatedItems };
      const updatedWithCache = withPeriodSnapshot(updated, get().analyticsPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      set({
        accounts: accs,
        ...(get().currentAccountId === id ? { items: updatedItems } : {}),
      });
      void (async () => {
        try {
          await repository.saveItems(id, updatedItems);
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] ensureItemImages:', e);
        }
      })();
    },

    saveExactItemDailyStats: async (rows, periodArg) => {
      const id = get().currentAccountId;
      if (!id || rows.length === 0) return;
      const period = periodArg ?? get().analyticsPeriod;
      try {
        await repository.saveItemDailyStats(id, rows);
        const [itemRows, spendRows] = await Promise.all([
          repository.loadItemDailyStats(id, period.from, period.to),
          repository.loadAccountDailySpend(id, period.from, period.to),
        ]);
        const current = get().accounts[id];
        if (!current) return;
        const cached = buildCachedPeriodData(current, itemRows, spendRows, period);
        if (!cached || cached.metrics.length === 0) return;
        const itemsWithRec = applyBidRecommendationsToItems(
          cached.items,
          current.kpi,
          cached.metrics
        );
        const recs = buildRecommendations(itemsWithRec, current.kpi, cached.metrics);
        const updated = withPeriodSnapshotData(current, period, {
          items: itemsWithRec,
          metrics: cached.metrics,
          recommendations: recs,
          accountCharges: current.accountCharges ?? [],
          hasPerItemSpend: cached.hasPerItemSpend,
          spendings: cached.spendings,
        });
        const accs = { ...get().accounts, [id]: updated };
        saveAccounts(accs);
        set({
          accounts: accs,
          ...(get().currentAccountId === id &&
          get().analyticsPeriod.from === period.from &&
          get().analyticsPeriod.to === period.to
            ? buildMirrorForPeriod(updated, period)
            : {}),
        });
        void repository.saveAccountCache(id, updated).catch((e) =>
          console.warn('[supabase] saveExactItemDailyStats account cache:', e)
        );
      } catch (e) {
        console.warn('[stats-cache] save exact item daily stats:', e);
      }
    },

    setKpi: (k) => {
      const id = get().currentAccountId;
      if (!id) return;
      const before = get().kpi;
      const accs = { ...get().accounts };
      const acc = { ...accs[id], kpi: k };
      const itemsWithRec = applyBidRecommendationsToItems(acc.items, k, acc.metrics);
      const recs = buildRecommendations(itemsWithRec, k, acc.metrics);
      acc.items = itemsWithRec;
      acc.recommendations = recs;
      accs[id] = acc;
      saveAccounts(accs);
      set({
        accounts: accs,
        kpi: k,
        items: itemsWithRec,
        recommendations: recs,
      });
      void repository.saveKpi(id, k).catch((e) => console.warn('[supabase] saveKpi:', e));
      get().log('kpi_changed', 'Изменены KPI аккаунта', undefined, { before, after: k });
    },

    recalc: () => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const items = applyBidRecommendationsToItems(acc.items, acc.kpi, acc.metrics);
      const recs = buildRecommendations(items, acc.kpi, acc.metrics);
      const updated = { ...acc, items, recommendations: recs };
      accs[id] = updated;
      saveAccounts(accs);
      set({ accounts: accs, items, recommendations: recs });
    },

    setItemBid: (itemId, newBid, reason = 'Ручное изменение') => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const oldItem = acc.items.find((i) => i.id === itemId);
      if (!oldItem) return;
      const oldBid = oldItem.currentBid;
      const updatedBid = Math.max(1, Math.round(newBid));
      const items = acc.items.map((i) =>
        i.id === itemId ? { ...i, currentBid: updatedBid } : i
      );
      const history: BidHistoryEntry = {
        id: genUuid(),
        itemId,
        date: new Date().toISOString(),
        oldBid,
        newBid: updatedBid,
        reason,
      };
      const updated = { ...acc, items, bidHistory: [history, ...acc.bidHistory] };
      // пересчёт
      const itemsWithRec = applyBidRecommendationsToItems(updated.items, updated.kpi, updated.metrics);
      const recs = buildRecommendations(itemsWithRec, updated.kpi, updated.metrics);
      updated.items = itemsWithRec;
      updated.recommendations = recs;
      const updatedWithCache = withPeriodSnapshot(updated, get().analyticsPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      set({
        accounts: accs,
        items: itemsWithRec,
        recommendations: recs,
        bidHistory: updated.bidHistory,
      });
      get().log(
        'item_bid_changed',
        `Ставка изменена: «${oldItem.title}» ${oldBid} → ${updatedBid} ₽`,
        reason,
        { before: { bid: oldBid }, after: { bid: updatedBid } }
      );
      void (async () => {
        try {
          await repository.saveItems(id, itemsWithRec);
          await repository.saveBidHistory({ ...history, accountId: id });
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] setItemBid persist:', e);
        }
      })();
      void adapter.updateBid(itemId, updatedBid);
    },

    applyRecommendation: (recId) => {
      const id = get().currentAccountId;
      if (!id) return;
      const acc = get().accounts[id];
      const rec = acc.recommendations.find((r) => r.id === recId);
      if (!rec) return;
      if (rec.itemId && rec.type === 'bid') {
        const item = acc.items.find((i) => i.id === rec.itemId);
        if (item)
          get().setItemBid(item.id, item.recommendedBid, `Принята рекомендация: ${rec.title}`);
      }
      const accs = { ...get().accounts };
      const next = {
        ...accs[id],
        recommendations: accs[id].recommendations.map((r) =>
          r.id === recId ? { ...r, status: 'accepted' as const } : r
        ),
      };
      accs[id] = next;
      saveAccounts(accs);
      set({ accounts: accs, recommendations: next.recommendations });
      get().log('recommendation_accepted', `Рекомендация принята: ${rec.title}`);
    },

    declineRecommendation: (recId) => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const rec = acc.recommendations.find((r) => r.id === recId);
      const next = {
        ...acc,
        recommendations: acc.recommendations.map((r) =>
          r.id === recId ? { ...r, status: 'declined' as const } : r
        ),
      };
      accs[id] = next;
      saveAccounts(accs);
      set({ accounts: accs, recommendations: next.recommendations });
      get().log(
        'recommendation_declined',
        `Рекомендация отклонена: ${rec?.title ?? recId}`
      );
    },

    postponeRecommendation: (recId) => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const rec = acc.recommendations.find((r) => r.id === recId);
      const next = {
        ...acc,
        recommendations: acc.recommendations.map((r) =>
          r.id === recId ? { ...r, status: 'postponed' as const } : r
        ),
      };
      accs[id] = next;
      saveAccounts(accs);
      set({ accounts: accs, recommendations: next.recommendations });
      get().log(
        'recommendation_postponed',
        `Рекомендация отложена: ${rec?.title ?? recId}`
      );
    },

    applyAllBidRecommendations: (limitPercent) => {
      const id = get().currentAccountId;
      if (!id) return 0;
      const accs = { ...get().accounts };
      const acc = accs[id];
      let applied = 0;
      const newHistory: BidHistoryEntry[] = [];
      const items = acc.items.map((item) => {
        const rec = calculateBidRecommendation(item, acc.kpi, acc.metrics);
        if (rec.thinData) return item;
        if (rec.diffPercent === 0) return item;
        if (rec.diffPercent > limitPercent) return item;
        if (rec.diffPercent > 0 && item.contacts === 0) return item;
        const newBid = rec.recommended;
        newHistory.push({
          id: genUuid(),
          itemId: item.id,
          date: new Date().toISOString(),
          oldBid: item.currentBid,
          newBid,
          reason: `Массовое применение: ${rec.reason}`,
        });
        applied++;
        return { ...item, currentBid: newBid };
      });
      const itemsWithRec = applyBidRecommendationsToItems(items, acc.kpi, acc.metrics);
      const recs = buildRecommendations(itemsWithRec, acc.kpi, acc.metrics);
      const updated = {
        ...acc,
        items: itemsWithRec,
        recommendations: recs,
        bidHistory: [...newHistory, ...acc.bidHistory],
      };
      const updatedWithCache = withPeriodSnapshot(updated, get().analyticsPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      set({
        accounts: accs,
        items: itemsWithRec,
        recommendations: recs,
        bidHistory: updatedWithCache.bidHistory,
      });
      get().log(
        'item_bid_bulk_applied',
        `Массовое применение рекомендаций по ставкам`,
        `Применено изменений: ${applied}, лимит повышения ${limitPercent}%`
      );
      void (async () => {
        try {
          await repository.saveItems(id, itemsWithRec);
          for (const h of newHistory) {
            await repository.saveBidHistory({ ...h, accountId: id });
          }
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] applyAllBidRecommendations:', e);
        }
      })();
      return applied;
    },

    setNote: (itemId, text) => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const next = { ...acc, notes: { ...acc.notes, [itemId]: text } };
      accs[id] = next;
      saveAccounts(accs);
      set({ accounts: accs, notes: next.notes });
      void repository.saveNote(id, itemId, text).catch((e) =>
        console.warn('[supabase] saveNote:', e)
      );
      const item = acc.items.find((i) => i.id === itemId);
      get().log('item_note_set', `Заметка к «${item?.title ?? itemId}» сохранена`);
    },

    updateIntegration: (s) => {
      const id = get().currentAccountId;
      if (!id) return;
      const accs = { ...get().accounts };
      const acc = accs[id];
      const before = acc.integration;
      const next: IntegrationSettings = { ...before, ...s };
      const updated = { ...acc, integration: next };
      accs[id] = updated;
      saveAccounts(accs);
      adapter.setSettings(next);
      set({ accounts: accs, integration: next });
      void repository.saveIntegration(id, next).catch((e) =>
        console.warn('[supabase] saveIntegration:', e)
      );
      // секреты не логируем
      get().log('integration_updated', `Изменены настройки интеграции (${next.mode})`, undefined, {
        before: { mode: before.mode, userId: before.userId },
        after: { mode: next.mode, userId: next.userId },
      });
      // ─── Авто-регистрация на прокси: если переключились в API и есть все три креда,
      // сразу регистрируем у backend, чтобы пользователю не приходилось править .env.
      if (
        next.mode === 'api' &&
        next.userId &&
        next.clientId &&
        next.clientSecret
      ) {
        void adapter.registerOnProxy().then((r) => {
          if (!r.ok) {
            console.warn('[adapter] registerOnProxy failed:', r.message);
          } else {
            console.info('[adapter]', r.message);
          }
        });
      }
    },

    reloadFromAdapter: async () => {
      const id = get().currentAccountId;
      if (!id) return;
      const accAtStart = get().accounts[id];
      if (!accAtStart) return;
      const scopedAdapter = new AvitoAdapter(accAtStart.integration);
      const syncPeriod = get().analyticsPeriod;
      set({ loading: true });
      try {
      // Запоминаем предыдущий снимок объявлений — будем сравнивать после fetch
      // и логировать изменения как события Авито (новые/снятые/изменённые).
      const prevItems = accAtStart.items;
      const items = await scopedAdapter.fetchItems();
      // Подтянуть ставки CPx и наложить на items.currentBid.
      // Передаём список числовых ID для батчевого запроса getPromotionsByItemIds.
      try {
        const numericIds = items
          .map((i) => Number(i.id))
          .filter((n) => Number.isFinite(n) && n > 0);
        const bids = await scopedAdapter.fetchBids(numericIds);
        if (bids.size > 0) {
          for (const it of items) {
            const b = bids.get(String(it.id));
            if (b && b > 0) it.currentBid = b;
          }
        }
      } catch (e) {
        console.warn('[adapter] fetchBids failed:', e);
      }
      const metrics = await scopedAdapter.fetchMetrics(items, {
        dateFrom: syncPeriod.from,
        dateTo: syncPeriod.to,
      });
      // Запоминаем — пришёл ли per-item spend из v2. Это переключает UI:
      // если да, не распределяем CPx-аванс повторно по показам.
      const nextHasPerItemSpend = !!scopedAdapter.lastMetricsHadV2Spend;
      // Подтягиваем «события из Авито» (история операций, входящие сообщения и т.п.)
      try {
        const events = await scopedAdapter.fetchAvitoEvents();
        if (events.length > 0) {
          get().ingestAvitoEvents(events.map((ev) => ({ ...ev, accountId: id })));
        }
      } catch (e) {
        console.warn('[adapter] fetchAvitoEvents failed:', e);
      }
      // ─── Diff prev vs new items → события в журнал ───
      // Только если у нас уже был непустой prev snapshot (т.е. не первый reload).
      try {
        if (prevItems.length > 0) {
          const diffEvents = diffItemsToEvents(prevItems, items);
          if (diffEvents.length > 0) {
            get().ingestAvitoEvents(diffEvents.map((ev) => ({ ...ev, accountId: id })));
          }
        }
      } catch (e) {
        console.warn('[adapter] diffItemsToEvents failed:', e);
      }
      // Баланс кошелька (real + bonus + CPA-аванс).
      let nextBalance = accAtStart.balance ?? null;
      try {
        const balance = await scopedAdapter.fetchBalance();
        if (balance) nextBalance = balance;
      } catch (e) {
        console.warn('[adapter] fetchBalance failed:', e);
      }
      // Общие расходы аккаунта (рассылки и т.п. без привязки к объявлению).
      let nextAccountCharges = accAtStart.accountCharges ?? [];
      try {
        nextAccountCharges = await scopedAdapter.fetchAccountCharges();
      } catch (e) {
        console.warn('[adapter] fetchAccountCharges failed:', e);
      }
      // Точные расходы профиля (Avito Pro Статистика → Расходы).
      let nextSpendings = accAtStart.spendings ?? null;
      try {
        const sp = await scopedAdapter.fetchSpendings({
          dateFrom: syncPeriod.from,
          dateTo: syncPeriod.to,
        });
        if (sp) nextSpendings = sp;
      } catch (e) {
        console.warn('[adapter] fetchSpendings failed:', e);
      }
      const accs = { ...get().accounts };
      const acc = accs[id];
      if (!acc) {
        set({ loading: false });
        return;
      }
      // Обогащаем items суммами из metrics — иначе таблица объявлений
      // показывает нули даже если статистика реально пришла.
      const enrichedItems = items.map((it) => {
        const itemMetrics = metrics.filter((m) => m.itemId === it.id);
        if (itemMetrics.length === 0) return it;
        const sum = itemMetrics.reduce(
          (s, m) => ({
            views: s.views + m.views,
            impressions: s.impressions + (m.impressions ?? 0),
            contacts: s.contacts + m.contacts,
            favorites: s.favorites + m.favorites,
            spend: s.spend + m.spend,
          }),
          { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 }
        );
        return {
          ...it,
          views: it.views || sum.views,
          impressions: it.impressions || sum.impressions || undefined,
          contacts: it.contacts || sum.contacts,
          favorites: it.favorites || sum.favorites,
          spend: it.spend || sum.spend,
        };
      });
      const itemsWithRec = applyBidRecommendationsToItems(enrichedItems, acc.kpi, metrics);
      const recs = buildRecommendations(itemsWithRec, acc.kpi, metrics);
      const updated: AccountData = {
        ...acc,
        items: itemsWithRec,
        metrics,
        recommendations: recs,
        integration: { ...acc.integration, lastSyncAt: new Date().toISOString() },
        balance: nextBalance,
        accountCharges: nextAccountCharges,
        hasPerItemSpend: nextHasPerItemSpend,
        spendings: nextSpendings,
      };
      const updatedWithCache = withPeriodSnapshot(updated, syncPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      const isStillActive = get().currentAccountId === id;
      set({
        accounts: accs,
        loading: false,
        ...(isStillActive ? buildMirrorForPeriod(updatedWithCache, get().analyticsPeriod) : {}),
      });
      void (async () => {
        try {
          await repository.saveItems(id, itemsWithRec);
          await repository.saveMetrics(id, metrics);
          await repository.saveItemDailyStats(
            id,
            itemDailyStatsFromMetrics(
              id,
              metrics,
              nextHasPerItemSpend ? 'exact' : 'partial'
            )
          );
          await repository.saveAccountDailySpend(
            id,
            accountDailySpendFromSpendings(id, nextSpendings)
          );
          await repository.saveIntegration(id, updatedWithCache.integration);
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] reloadFromAdapter:', e);
        }
      })();
      get().log('data_reloaded', 'Синхронизация данных из интеграции');
      } catch (e) {
        console.warn('[adapter] reloadFromAdapter failed:', e);
        set({ loading: false });
      }
    },

    applyImportedData: (items, metrics) => {
      const id = get().currentAccountId;
      if (!id) return;
      const enriched = items.map((it) => {
        const itemMetrics = metrics.filter((m) => m.itemId === it.id);
        if (itemMetrics.length === 0) return it;
        const sum = itemMetrics.reduce(
          (acc, m) => ({
            views: acc.views + m.views,
            impressions: acc.impressions + (m.impressions ?? 0),
            contacts: acc.contacts + m.contacts,
            favorites: acc.favorites + m.favorites,
            spend: acc.spend + m.spend,
          }),
          { views: 0, impressions: 0, contacts: 0, favorites: 0, spend: 0 }
        );
        return {
          ...it,
          views: it.views || sum.views,
          impressions: it.impressions || sum.impressions || undefined,
          contacts: it.contacts || sum.contacts,
          favorites: it.favorites || sum.favorites,
          spend: it.spend || sum.spend,
        };
      });
      const accs = { ...get().accounts };
      const acc = accs[id];
      const itemsWithRec = applyBidRecommendationsToItems(enriched, acc.kpi, metrics);
      const recs = buildRecommendations(itemsWithRec, acc.kpi, metrics);
      const updated: AccountData = {
        ...acc,
        items: itemsWithRec,
        metrics,
        recommendations: recs,
        integration: {
          ...acc.integration,
          mode: 'csv',
          lastSyncAt: new Date().toISOString(),
        },
        accountCharges: [],
        hasPerItemSpend: true,
        spendings: null,
      };
      const updatedWithCache = withPeriodSnapshot(updated, get().analyticsPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      set({
        accounts: accs,
        items: itemsWithRec,
        metrics,
        recommendations: recs,
        integration: updated.integration,
        accountCharges: [],
        hasPerItemSpend: true,
        spendings: null,
      });
      void (async () => {
        try {
          await repository.saveItems(id, itemsWithRec);
          await repository.saveMetrics(id, metrics);
          await repository.saveItemDailyStats(
            id,
            itemDailyStatsFromMetrics(id, metrics, 'exact')
          );
          await repository.saveIntegration(id, updatedWithCache.integration);
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] applyImportedData:', e);
        }
      })();
      get().log(
        'csv_imported',
        `Импорт CSV выполнен`,
        `Объявлений: ${items.length}, метрик: ${metrics.length}`
      );
    },

    resetToDemo: async () => {
      const id = get().currentAccountId;
      if (!id) return;
      set({ loading: true });
      const accs = { ...get().accounts };
      const acc = { ...accs[id], integration: { ...accs[id].integration, mode: 'demo' as const } };
      adapter.setSettings(acc.integration);
      const items = await adapter.fetchItems();
      const metrics = await adapter.fetchMetrics(items, {
        dateFrom: get().analyticsPeriod.from,
        dateTo: get().analyticsPeriod.to,
      });
      const itemsWithRec = applyBidRecommendationsToItems(items, acc.kpi, metrics);
      const recs = buildRecommendations(itemsWithRec, acc.kpi, metrics);
      const updated: AccountData = {
        ...acc,
        items: itemsWithRec,
        metrics,
        recommendations: recs,
        balance: null,
        accountCharges: [],
        hasPerItemSpend: false,
        spendings: null,
      };
      const updatedWithCache = withPeriodSnapshot(updated, get().analyticsPeriod);
      accs[id] = updatedWithCache;
      saveAccounts(accs);
      set({
        accounts: accs,
        items: itemsWithRec,
        metrics,
        recommendations: recs,
        integration: updatedWithCache.integration,
        balance: null,
        accountCharges: [],
        hasPerItemSpend: false,
        spendings: null,
        loading: false,
      });
      void (async () => {
        try {
          await repository.saveItems(id, itemsWithRec);
          await repository.saveMetrics(id, metrics);
          await repository.saveIntegration(id, updatedWithCache.integration);
          await repository.saveAccountCache(id, updatedWithCache);
        } catch (e) {
          console.warn('[supabase] resetToDemo:', e);
        }
      })();
      get().log('reset_to_demo', 'Сброс к демо-данным');
    },

    log: (type, title, details, extras) => {
      const source = extras?.source ?? 'platform';
      if (source !== 'avito') return;

      const userId = get().currentUser?.id ?? 'anonymous';
      const accountId = get().currentAccountId ?? undefined;
      const entry: ActionLogEntry = {
        id: genUuid(),
        timestamp: new Date().toISOString(),
        userId,
        accountId,
        type,
        source,
        title,
        details,
        before: extras?.before,
        after: extras?.after,
      };
      const next = [entry, ...get().actionLog];
      saveLog(next);
      set({ actionLog: next });
      if (userId !== 'anonymous') {
        void repository.saveActionLog(entry).catch(() => {
          // RLS отклонит, если userId не совпадает с auth.uid() — не падаем
        });
      }
    },

    ingestAvitoEvents: (events) => {
      const userId = get().currentUser?.id ?? 'anonymous';
      const accountId = get().currentAccountId ?? undefined;
      // Дедупликация: один и тот же type+title+timestamp не добавляем повторно.
      const existing = new Set(
        get().actionLog
          .filter((e) => e.source === 'avito')
          .map((e) => `${e.type}|${e.title}|${e.timestamp}`)
      );
      const fresh: ActionLogEntry[] = events
        .map((ev) => ({
          id: genUuid(),
          timestamp: ev.timestamp,
          userId,
          accountId: ev.accountId ?? accountId,
          type: ev.type,
          source: 'avito' as const,
          title: ev.title,
          details: ev.details,
          before: ev.before,
          after: ev.after,
        }))
        .filter((e) => !existing.has(`${e.type}|${e.title}|${e.timestamp}`));
      if (fresh.length === 0) return;
      const next = [...fresh, ...get().actionLog].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      );
      saveLog(next);
      set({ actionLog: next });
      if (userId !== 'anonymous') {
        for (const e of fresh) {
          void repository.saveActionLog(e).catch(() => {});
        }
      }
    },

    clearLog: () => {
      saveLog([]);
      set({ actionLog: [] });
      const userId = get().currentUser?.id;
      if (userId) {
        void repository.clearActionLog(userId).catch((e) =>
          console.warn('[supabase] clearLog:', e)
        );
      }
    },
  };
});
