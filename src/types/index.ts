export type AccountKpi = {
  targetCpl: number;
  targetLeads: number;
  targetConversionRate: number;
  monthlyBudget: number;
  weeklyBudget: number;
  dailyBudget: number;
  targetRoi: number;
  allowedOverspend: number;
  strategy: 'leads' | 'cpl' | 'balanced' | 'roi';
};

export type AvitoItemStatus = 'active' | 'paused' | 'archived';

export type AvitoItem = {
  id: string;
  title: string;
  status: AvitoItemStatus;
  category: string;
  region: string;
  price: number;
  currentBid: number;
  recommendedBid: number;
  /** Уникальные просмотры карточки объявления (uniqViews в Avito API). */
  views: number;
  /**
   * Показы (impressions) — сколько раз объявление показывалось в выдаче
   * (views в Avito API). Опционально — может отсутствовать в данных CSV-импорта
   * и старых записях localStorage.
   */
  impressions?: number;
  contacts: number;
  favorites: number;
  spend: number;
  revenue?: number;
  createdAt: string;
  /** Ссылка на объявление на Авито (приходит из /core/v1/items в поле url). */
  url?: string;
  /** Первое фото объявления, если API Авито вернуло изображения. */
  imageUrl?: string;
};

export type ItemMetrics = {
  itemId: string;
  date: string;
  /** Уникальные просмотры карточки (uniqViews). */
  views: number;
  /** Показы (impressions). Опционально — могут отсутствовать в старых данных. */
  impressions?: number;
  contacts: number;
  favorites: number;
  spend: number;
  bid: number;
};

export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationType =
  | 'bid'
  | 'budget'
  | 'content'
  | 'price'
  | 'kpi'
  | 'account';
export type RecommendationStatus =
  | 'new'
  | 'accepted'
  | 'declined'
  | 'postponed';

export type Recommendation = {
  id: string;
  itemId?: string;
  priority: RecommendationPriority;
  type: RecommendationType;
  title: string;
  description: string;
  expectedEffect: string;
  actionLabel: string;
  status: RecommendationStatus;
  group?: string;
};

export type BidHistoryEntry = {
  id: string;
  itemId: string;
  date: string;
  oldBid: number;
  newBid: number;
  reason: string;
};

export type IntegrationMode = 'demo' | 'api' | 'csv';

export type IntegrationSettings = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  userId: string;
  mode: IntegrationMode;
  lastSyncAt?: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  accountIds: string[];
};

export type Session = {
  userId: string;
  startedAt: string;
};

export type AccountPeriodCacheEntry = {
  from: string;
  to: string;
  savedAt: string;
  items: AvitoItem[];
  metrics: ItemMetrics[];
  recommendations: Recommendation[];
  accountCharges?: Array<{
    date: string;
    amount: number;
    description: string;
    kind: 'promotion_pool' | 'account_other' | 'refund';
  }>;
  hasPerItemSpend?: boolean;
  spendings?: {
    promotion: number;
    presence: number;
    commission: number;
    rest: number;
    total: number;
    byDate: Array<{
      date: string;
      promotion: number;
      presence: number;
      ads: number;
      total: number;
    }>;
  } | null;
};

export type AccountData = {
  id: string;
  name: string;
  ownerId: string;
  integration: IntegrationSettings;
  kpi: AccountKpi;
  items: AvitoItem[];
  metrics: ItemMetrics[];
  bidHistory: BidHistoryEntry[];
  notes: Record<string, string>;
  recommendations: Recommendation[];
  /** Кеш снимков данных по выбранным периодам, чтобы вкладки/аккаунты не обнуляли UI. */
  periodCache?: Record<string, AccountPeriodCacheEntry>;
  createdAt: string;
  /** Последний загруженный баланс аккаунта. Хранится как кеш, чтобы не обнулять UI при навигации. */
  balance?: {
    real: number;
    bonus: number;
    advance: number;
    fetchedAt: string;
  } | null;
  /** Последние общие расходы аккаунта без привязки к объявлениям. */
  accountCharges?: Array<{
    date: string;
    amount: number;
    description: string;
    kind: 'promotion_pool' | 'account_other' | 'refund';
  }>;
  /** Флаг, что per-item spend уже пришёл из Avito stats v2. */
  hasPerItemSpend?: boolean;
  /** Последняя разбивка расходов профиля из Avito Pro статистики. */
  spendings?: {
    promotion: number;
    presence: number;
    commission: number;
    rest: number;
    total: number;
    byDate: Array<{
      date: string;
      promotion: number;
      presence: number;
      ads: number;
      total: number;
    }>;
  } | null;
};

export type ActionType =
  | 'login'
  | 'logout'
  | 'signup'
  | 'account_created'
  | 'account_renamed'
  | 'account_removed'
  | 'account_switched'
  | 'kpi_changed'
  | 'item_bid_changed'
  | 'item_bid_bulk_applied'
  | 'recommendation_accepted'
  | 'recommendation_declined'
  | 'recommendation_postponed'
  | 'csv_imported'
  | 'integration_updated'
  | 'item_note_set'
  | 'data_reloaded'
  | 'reset_to_demo'
  // ─── события, прилетающие из самого Авито (через API) ───
  | 'avito_item_published'
  | 'avito_item_archived'
  | 'avito_item_edited'
  | 'avito_promotion_applied'
  | 'avito_promotion_stopped'
  | 'avito_balance_topup'
  | 'avito_balance_charge'
  | 'avito_message_received'
  | 'avito_call_received'
  | 'avito_review_received'
  | 'avito_other';

/**
 * Источник события в журнале.
 * - `platform` — действие пользователя на нашей платформе (наш UI и кнопки)
 * - `avito`   — событие, произошедшее в самом аккаунте Авито
 *               (получено через API: пополнение баланса, ответ продавца,
 *               снятие объявления и т.д.)
 */
export type ActionSource = 'platform' | 'avito';

export type ActionLogEntry = {
  id: string;
  timestamp: string;
  userId: string;
  accountId?: string;
  type: ActionType;
  source: ActionSource;
  title: string;
  details?: string;
  before?: unknown;
  after?: unknown;
};
