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
  views: number;
  contacts: number;
  favorites: number;
  spend: number;
  revenue?: number;
  createdAt: string;
};

export type ItemMetrics = {
  itemId: string;
  date: string;
  views: number;
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
  createdAt: string;
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
  | 'reset_to_demo';

export type ActionLogEntry = {
  id: string;
  timestamp: string;
  userId: string;
  accountId?: string;
  type: ActionType;
  title: string;
  details?: string;
  before?: unknown;
  after?: unknown;
};
