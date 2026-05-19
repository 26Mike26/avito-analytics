import type {
  AccountData,
  AccountDailySpend,
  AccountKpi,
  ActionLogEntry,
  AvitoItem,
  BidHistoryEntry,
  IntegrationSettings,
  ItemDailyStat,
  ItemMetrics,
  StatsAccuracy,
} from '../types';
import { SUPABASE_ENABLED, supabase } from './supabase';

/**
 * Абстракция над хранилищем. Локальная реализация работает с localStorage
 * (текущее поведение), Supabase-реализация пишет в Postgres через RLS.
 */

type AccountCacheData = Pick<
  AccountData,
  'balance' | 'accountCharges' | 'hasPerItemSpend' | 'spendings' | 'periodCache'
>;

export interface IRepository {
  loadUserAccounts(userId: string): Promise<AccountData[]>;
  saveAccount(acc: AccountData): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;

  saveItems(accountId: string, items: AvitoItem[]): Promise<void>;
  saveMetrics(accountId: string, metrics: ItemMetrics[]): Promise<void>;
  saveBidHistory(entry: BidHistoryEntry & { accountId: string }): Promise<void>;
  saveNote(accountId: string, itemId: string, text: string): Promise<void>;
  saveKpi(accountId: string, kpi: AccountKpi): Promise<void>;
  saveIntegration(accountId: string, integration: IntegrationSettings): Promise<void>;
  saveAccountCache(accountId: string, cache: AccountCacheData): Promise<void>;
  loadItemDailyStats(accountId: string, from: string, to: string): Promise<ItemDailyStat[]>;
  saveItemDailyStats(accountId: string, stats: ItemDailyStat[]): Promise<void>;
  loadAccountDailySpend(accountId: string, from: string, to: string): Promise<AccountDailySpend[]>;
  saveAccountDailySpend(accountId: string, rows: AccountDailySpend[]): Promise<void>;

  saveActionLog(entry: ActionLogEntry): Promise<void>;
  loadActionLog(userId: string): Promise<ActionLogEntry[]>;
  clearActionLog(userId: string): Promise<void>;
}

const ACCURACY_RANK: Record<StatsAccuracy, number> = {
  fallback: 0,
  partial: 1,
  exact: 2,
};

// ───────────────────────── Supabase реализация ─────────────────────────

class SupabaseRepository implements IRepository {
  private get sb() {
    return supabase!;
  }

  async loadUserAccounts(userId: string): Promise<AccountData[]> {
    const { data: accs, error } = await this.sb
      .from('accounts')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!accs || accs.length === 0) return [];

    const accIds = accs.map((a) => a.id);

    const [
      { data: items },
      { data: metrics },
      { data: bidHist },
      { data: notes },
      { data: cacheRows },
    ] = await Promise.all([
        this.sb.from('items').select('*').in('account_id', accIds),
        this.sb.from('metrics').select('*').in('account_id', accIds),
        this.sb
          .from('bid_history')
          .select('*')
          .in('account_id', accIds)
          .order('created_at', { ascending: false }),
        this.sb.from('notes').select('*').in('account_id', accIds),
        this.sb.from('account_cache').select('*').in('account_id', accIds),
      ]);
    const cacheByAccount = new Map(
      (cacheRows ?? []).map((row) => [row.account_id, row])
    );

    return accs.map((a) => {
      const cache = cacheByAccount.get(a.id);
      return {
        id: a.id,
        ownerId: a.owner_id,
        name: a.name,
        createdAt: a.created_at,
        kpi: a.kpi as AccountKpi,
        integration: {
          mode: a.integration_mode,
          userId: a.integration_user_id ?? '',
          clientId: a.integration_client_id ?? '',
          clientSecret: a.integration_client_secret ?? '',
          accessToken: a.integration_access_token ?? '',
          lastSyncAt: a.last_sync_at ?? undefined,
        },
        items: (items ?? [])
          .filter((i) => i.account_id === a.id)
          .map((i) => i.data as AvitoItem),
        metrics: (metrics ?? [])
          .filter((m) => m.account_id === a.id)
          .map((m) => m.data as ItemMetrics),
        bidHistory: (bidHist ?? [])
          .filter((h) => h.account_id === a.id)
          .map((h) => ({
            id: h.id,
            itemId: h.item_id,
            oldBid: Number(h.old_bid),
            newBid: Number(h.new_bid),
            reason: h.reason ?? '',
            date: h.created_at,
          })),
        notes: Object.fromEntries(
          (notes ?? [])
            .filter((n) => n.account_id === a.id)
            .map((n) => [n.item_id, n.text])
        ),
        recommendations: [], // вычисляются на клиенте
        balance: cache
          ? (cache.balance as AccountData['balance'] | undefined) ?? null
          : undefined,
        accountCharges: cache
          ? (cache.account_charges as AccountData['accountCharges'] | undefined) ??
            []
          : undefined,
        hasPerItemSpend: cache
          ? Boolean(cache.has_per_item_spend)
          : undefined,
        spendings: cache
          ? (cache.spendings as AccountData['spendings'] | undefined) ?? null
          : undefined,
        periodCache: cache
          ? ((cache.meta as { periodCache?: AccountData['periodCache'] } | null)?.periodCache ?? {})
          : undefined,
      };
    });
  }

  async saveAccount(acc: AccountData): Promise<void> {
    const { error } = await this.sb.from('accounts').upsert({
      id: acc.id,
      owner_id: acc.ownerId,
      name: acc.name,
      kpi: acc.kpi,
      integration_mode: acc.integration.mode,
      integration_user_id: acc.integration.userId,
      integration_client_id: acc.integration.clientId,
      integration_client_secret: acc.integration.clientSecret,
      integration_access_token: acc.integration.accessToken,
      last_sync_at: acc.integration.lastSyncAt ?? null,
      created_at: acc.createdAt,
    });
    if (error) throw error;
  }

  async deleteAccount(accountId: string): Promise<void> {
    const { error } = await this.sb.from('accounts').delete().eq('id', accountId);
    if (error) throw error;
  }

  async saveItems(accountId: string, items: AvitoItem[]): Promise<void> {
    if (items.length === 0) return;
    // полная перезапись — простой вариант
    await this.sb.from('items').delete().eq('account_id', accountId);
    const rows = items.map((it) => ({
      account_id: accountId,
      item_id: it.id,
      data: it,
    }));
    const { error } = await this.sb.from('items').insert(rows);
    if (error) throw error;
  }

  async saveMetrics(accountId: string, metrics: ItemMetrics[]): Promise<void> {
    if (metrics.length === 0) return;
    await this.sb.from('metrics').delete().eq('account_id', accountId);
    const rows = metrics.map((m) => ({
      account_id: accountId,
      item_id: m.itemId,
      date: m.date,
      data: m,
    }));
    const { error } = await this.sb.from('metrics').insert(rows);
    if (error) throw error;
  }

  async saveBidHistory(
    entry: BidHistoryEntry & { accountId: string }
  ): Promise<void> {
    const { error } = await this.sb.from('bid_history').insert({
      id: entry.id,
      account_id: entry.accountId,
      item_id: entry.itemId,
      old_bid: entry.oldBid,
      new_bid: entry.newBid,
      reason: entry.reason,
      created_at: entry.date,
    });
    if (error) throw error;
  }

  async saveNote(accountId: string, itemId: string, text: string): Promise<void> {
    const { error } = await this.sb.from('notes').upsert({
      account_id: accountId,
      item_id: itemId,
      text,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async saveKpi(accountId: string, kpi: AccountKpi): Promise<void> {
    const { error } = await this.sb
      .from('accounts')
      .update({ kpi })
      .eq('id', accountId);
    if (error) throw error;
  }

  async saveIntegration(
    accountId: string,
    integration: IntegrationSettings
  ): Promise<void> {
    const { error } = await this.sb
      .from('accounts')
      .update({
        integration_mode: integration.mode,
        integration_user_id: integration.userId,
        integration_client_id: integration.clientId,
        integration_client_secret: integration.clientSecret,
        integration_access_token: integration.accessToken,
        last_sync_at: integration.lastSyncAt ?? null,
      })
      .eq('id', accountId);
    if (error) throw error;
  }

  async saveAccountCache(
    accountId: string,
    cache: AccountCacheData
  ): Promise<void> {
    const { error } = await this.sb.from('account_cache').upsert({
      account_id: accountId,
      balance: cache.balance ?? null,
      account_charges: cache.accountCharges ?? [],
      has_per_item_spend: !!cache.hasPerItemSpend,
      spendings: cache.spendings ?? null,
      meta: {
        savedAt: new Date().toISOString(),
        periodCache: cache.periodCache ?? {},
      },
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[supabase] account_cache upsert error', error.message);
    }
  }

  async loadItemDailyStats(
    accountId: string,
    from: string,
    to: string
  ): Promise<ItemDailyStat[]> {
    const { data, error } = await this.sb
      .from('item_daily_stats')
      .select('*')
      .eq('account_id', accountId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      accountId: row.account_id,
      itemId: String(row.item_id),
      date: row.date,
      views: Number(row.views ?? 0),
      impressions: Number(row.impressions ?? 0),
      contacts: Number(row.contacts ?? 0),
      favorites: Number(row.favorites ?? 0),
      spend: Number(row.spend ?? 0),
      bid: Number(row.bid ?? 0),
      accuracy: (row.accuracy as StatsAccuracy) ?? 'fallback',
      updatedAt: row.updated_at ?? undefined,
    }));
  }

  async saveItemDailyStats(
    accountId: string,
    stats: ItemDailyStat[]
  ): Promise<void> {
    if (stats.length === 0) return;
    const rows = stats.map((row) => ({
      account_id: accountId,
      item_id: row.itemId,
      date: row.date,
      views: Math.max(0, Math.round(row.views ?? 0)),
      impressions: Math.max(0, Math.round(row.impressions ?? 0)),
      contacts: Math.max(0, Math.round(row.contacts ?? 0)),
      favorites: Math.max(0, Math.round(row.favorites ?? 0)),
      spend: Math.max(0, Math.round(row.spend ?? 0)),
      bid: Math.max(0, Math.round(row.bid ?? 0)),
      accuracy: row.accuracy,
      updated_at: new Date().toISOString(),
    }));
    const from = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date);
    const to = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date);
    const itemIds = Array.from(new Set(rows.map((row) => row.item_id)));
    const { data: existing, error: existingError } = await this.sb
      .from('item_daily_stats')
      .select('item_id,date,accuracy')
      .eq('account_id', accountId)
      .in('item_id', itemIds)
      .gte('date', from)
      .lte('date', to);
    if (existingError) throw existingError;
    const existingAccuracy = new Map(
      (existing ?? []).map((row) => [
        `${row.item_id}:${row.date}`,
        ((row.accuracy as StatsAccuracy) ?? 'fallback') as StatsAccuracy,
      ])
    );
    const upsertRows = rows.filter((row) => {
      const prev = existingAccuracy.get(`${row.item_id}:${row.date}`);
      return !prev || ACCURACY_RANK[row.accuracy] >= ACCURACY_RANK[prev];
    });
    if (upsertRows.length === 0) return;
    const { error } = await this.sb
      .from('item_daily_stats')
      .upsert(upsertRows, { onConflict: 'account_id,item_id,date' });
    if (error) throw error;
  }

  async loadAccountDailySpend(
    accountId: string,
    from: string,
    to: string
  ): Promise<AccountDailySpend[]> {
    const { data, error } = await this.sb
      .from('account_daily_spend')
      .select('*')
      .eq('account_id', accountId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      accountId: row.account_id,
      date: row.date,
      promotion: Number(row.promotion ?? 0),
      presence: Number(row.presence ?? 0),
      commission: Number(row.commission ?? 0),
      rest: Number(row.rest ?? 0),
      ads: Number(row.ads ?? 0),
      total: Number(row.total ?? 0),
      accuracy: (row.accuracy as StatsAccuracy) ?? 'fallback',
      updatedAt: row.updated_at ?? undefined,
    }));
  }

  async saveAccountDailySpend(
    accountId: string,
    spendRows: AccountDailySpend[]
  ): Promise<void> {
    if (spendRows.length === 0) return;
    const rows = spendRows.map((row) => ({
      account_id: accountId,
      date: row.date,
      promotion: Math.max(0, Math.round(row.promotion ?? 0)),
      presence: Math.max(0, Math.round(row.presence ?? 0)),
      commission: Math.max(0, Math.round(row.commission ?? 0)),
      rest: Math.max(0, Math.round(row.rest ?? 0)),
      ads: Math.max(0, Math.round(row.ads ?? 0)),
      total: Math.max(0, Math.round(row.total ?? 0)),
      accuracy: row.accuracy,
      updated_at: new Date().toISOString(),
    }));
    const from = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date);
    const to = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date);
    const { data: existing, error: existingError } = await this.sb
      .from('account_daily_spend')
      .select('date,accuracy')
      .eq('account_id', accountId)
      .gte('date', from)
      .lte('date', to);
    if (existingError) throw existingError;
    const existingAccuracy = new Map(
      (existing ?? []).map((row) => [
        row.date,
        ((row.accuracy as StatsAccuracy) ?? 'fallback') as StatsAccuracy,
      ])
    );
    const upsertRows = rows.filter((row) => {
      const prev = existingAccuracy.get(row.date);
      return !prev || ACCURACY_RANK[row.accuracy] >= ACCURACY_RANK[prev];
    });
    if (upsertRows.length === 0) return;
    const { error } = await this.sb
      .from('account_daily_spend')
      .upsert(upsertRows, { onConflict: 'account_id,date' });
    if (error) throw error;
  }

  async saveActionLog(entry: ActionLogEntry): Promise<void> {
    const { error } = await this.sb.from('action_log').insert({
      id: entry.id,
      user_id: entry.userId,
      account_id: entry.accountId ?? null,
      type: entry.type,
      source: entry.source ?? 'platform',
      title: entry.title,
      details: entry.details ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      created_at: entry.timestamp,
    });
    if (error) console.warn('[supabase] action_log insert error', error.message);
  }

  async loadActionLog(userId: string): Promise<ActionLogEntry[]> {
    const { data, error } = await this.sb
      .from('action_log')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'avito')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      accountId: r.account_id ?? undefined,
      type: r.type,
      source: (r.source as 'platform' | 'avito' | null) ?? 'platform',
      title: r.title,
      details: r.details ?? undefined,
      before: r.before,
      after: r.after,
      timestamp: r.created_at,
    }));
  }

  async clearActionLog(userId: string): Promise<void> {
    const { error } = await this.sb.from('action_log').delete().eq('user_id', userId);
    if (error) throw error;
  }
}

// ───────────────────────── Локальная реализация (no-op) ─────────────────────────
// В локальном режиме данные уже хранятся в localStorage самим стором.
// Здесь нужны методы, чтобы не пришлось ставить условия в каждом вызове.

class LocalRepository implements IRepository {
  async loadUserAccounts() {
    return [];
  }
  async saveAccount() {}
  async deleteAccount() {}
  async saveItems() {}
  async saveMetrics() {}
  async saveBidHistory() {}
  async saveNote() {}
  async saveKpi() {}
  async saveIntegration() {}
  async saveAccountCache() {}
  async loadItemDailyStats() {
    return [];
  }
  async saveItemDailyStats() {}
  async loadAccountDailySpend() {
    return [];
  }
  async saveAccountDailySpend() {}
  async saveActionLog() {}
  async loadActionLog() {
    return [];
  }
  async clearActionLog() {}
}

export const repository: IRepository = SUPABASE_ENABLED
  ? new SupabaseRepository()
  : new LocalRepository();
