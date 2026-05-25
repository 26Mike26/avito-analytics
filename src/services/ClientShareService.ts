import type {
  AccountData,
  AccountDailySpend,
  ClientShare,
  ClientShareStatus,
  ItemDailyStat,
} from '../types';
import { SUPABASE_ENABLED, supabase } from './supabase';

/**
 * Сервис управления клиентскими доступ-ссылками.
 *
 * Два режима хранения:
 *  • Supabase (SUPABASE_ENABLED) — таблица `client_shares` + RPC
 *    `resolve_client_share` / `client_share_accounts` (см. supabase/client_shares.sql).
 *    Доступы синхронизируются между устройствами, ссылка работает у клиента.
 *  • localStorage — fallback для локального демо-режима. Доступы видны
 *    только на устройстве, где созданы.
 *
 * Все функции асинхронные, чтобы режимы были взаимозаменяемы.
 */

const STORAGE_KEY = 'avito-client-shares';
const CLIENT_TOKEN_KEY = 'avito-client-token';

// ───────────────────────── Хелперы токена ─────────────────────────

/** Читает токен доступа из query-параметра `ct` текущего URL. */
export function readClientTokenFromUrl(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    const value = new URLSearchParams(window.location.search).get('ct');
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function saveClientToken(token: string): void {
  try {
    localStorage.setItem(CLIENT_TOKEN_KEY, token);
  } catch {
    // localStorage может быть недоступен — не блокируем интерфейс.
  }
}

export function loadClientToken(): string | null {
  try {
    return localStorage.getItem(CLIENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearClientToken(): void {
  try {
    localStorage.removeItem(CLIENT_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** Полная ссылка для передачи клиенту. */
export function buildClientShareUrl(token: string): string {
  const origin =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : '';
  return `${origin}/client?ct=${token}`;
}

// ──────────────────────── Статус доступа ──────────────────────────

/** Статус доступа: активен / отозван / истёк по сроку. */
export function clientShareStatus(share: ClientShare): ClientShareStatus {
  if (share.revokedAt) return 'revoked';
  if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
    return 'expired';
  }
  return 'active';
}

export function isClientShareActive(share: ClientShare): boolean {
  return clientShareStatus(share) === 'active';
}

// ───────────────────────── Генераторы ─────────────────────────────

/** Длинный случайный токен (~40 символов hex). */
function generateToken(): string {
  const chunk = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    return (
      Math.random().toString(36).slice(2) +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2)
    );
  };
  return `${chunk()}${chunk()}`.slice(0, 40);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────── localStorage backend ─────────────────────

function loadAll(): ClientShare[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ClientShare[]) : [];
  } catch {
    return [];
  }
}

function saveAll(shares: ClientShare[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shares));
  } catch {
    // Не блокируем интерфейс, если браузер запретил localStorage.
  }
}

// ─────────────────────── Supabase backend ─────────────────────────

type ClientShareRow = {
  id: string;
  token: string;
  owner_id: string;
  label: string;
  account_ids: string[] | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

function rowToShare(row: ClientShareRow): ClientShare {
  return {
    id: row.id,
    token: row.token,
    ownerUserId: row.owner_id,
    label: row.label,
    accountIds: row.account_ids ?? [],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

// ───────────────────────── Публичный API ──────────────────────────

export type CreateClientShareInput = {
  ownerUserId: string;
  label: string;
  accountIds: string[];
  /** ISO-дата окончания или null — бессрочно. */
  expiresAt?: string | null;
};

/** Список доступов владельца, новые — сверху. */
export async function listClientShares(
  ownerUserId: string
): Promise<ClientShare[]> {
  if (SUPABASE_ENABLED && supabase) {
    const { data, error } = await supabase
      .from('client_shares')
      .select('*')
      .eq('owner_id', ownerUserId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data as ClientShareRow[] | null) ?? []).map(rowToShare);
  }
  return loadAll()
    .filter((share) => share.ownerUserId === ownerUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createClientShare(
  input: CreateClientShareInput
): Promise<ClientShare> {
  const token = generateToken();
  const accountIds = Array.from(new Set(input.accountIds));
  const label = input.label.trim();
  const expiresAt = input.expiresAt ?? null;

  if (SUPABASE_ENABLED && supabase) {
    const { data, error } = await supabase
      .from('client_shares')
      .insert({
        token,
        owner_id: input.ownerUserId,
        label,
        account_ids: accountIds,
        expires_at: expiresAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return rowToShare(data as ClientShareRow);
  }

  const share: ClientShare = {
    id: generateId(),
    token,
    ownerUserId: input.ownerUserId,
    label,
    accountIds,
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
  };
  saveAll([share, ...loadAll()]);
  return share;
}

/** Отзывает доступ — ссылка перестаёт работать, но запись остаётся. */
export async function revokeClientShare(id: string): Promise<void> {
  if (SUPABASE_ENABLED && supabase) {
    const { error } = await supabase
      .from('client_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null);
    if (error) throw error;
    return;
  }
  const next = loadAll().map((share) =>
    share.id === id && !share.revokedAt
      ? { ...share, revokedAt: new Date().toISOString() }
      : share
  );
  saveAll(next);
}

/** Полностью удаляет запись о доступе. */
export async function deleteClientShare(id: string): Promise<void> {
  if (SUPABASE_ENABLED && supabase) {
    const { error } = await supabase
      .from('client_shares')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return;
  }
  saveAll(loadAll().filter((share) => share.id !== id));
}

/**
 * Резолвит токен в доступ. Возвращает null, если токен не найден,
 * отозван или истёк. Используется при входе клиента по ссылке.
 */
export async function resolveClientShareToken(
  token: string
): Promise<ClientShare | null> {
  if (SUPABASE_ENABLED && supabase) {
    const { data, error } = await supabase.rpc('resolve_client_share', {
      p_token: token,
    });
    if (error) throw error;
    if (!data) return null;
    const share = data as {
      id: string;
      token: string;
      ownerUserId: string;
      label: string;
      accountIds: string[] | null;
      createdAt: string;
      expiresAt: string | null;
      revokedAt: string | null;
    };
    return {
      id: share.id,
      token: share.token,
      ownerUserId: share.ownerUserId,
      label: share.label,
      accountIds: share.accountIds ?? [],
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
    };
  }
  const share = loadAll().find((item) => item.token === token);
  if (!share) return null;
  return isClientShareActive(share) ? share : null;
}

/**
 * Загружает данные аккаунтов, доступных по токену (только Supabase-режим).
 * В локальном режиме возвращает null — вызывающий код берёт аккаунты из
 * локального стора по share.accountIds.
 */
export async function loadSharedAccounts(
  token: string
): Promise<AccountData[] | null> {
  if (SUPABASE_ENABLED && supabase) {
    const { data, error } = await supabase.rpc('client_share_accounts', {
      p_token: token,
    });
    if (error) throw error;
    if (!data) return [];
    return data as AccountData[];
  }
  return null;
}

/** Точная дневная статистика за период по аккаунтам доступа. */
export type SharedPeriodAccount = {
  accountId: string;
  itemDailyStats: ItemDailyStat[];
  accountDailySpend: AccountDailySpend[];
};

/**
 * Загружает точную статистику (item_daily_stats + account_daily_spend) за
 * период для аккаунтов доступа (только Supabase-режим). Используется, чтобы
 * затраты в клиентском кабинете совпадали с данными владельца.
 */
export async function loadSharedPeriod(
  token: string,
  from: string,
  to: string
): Promise<SharedPeriodAccount[] | null> {
  if (SUPABASE_ENABLED && supabase) {
    const { data, error } = await supabase.rpc('client_share_period', {
      p_token: token,
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    if (!data) return [];
    return data as SharedPeriodAccount[];
  }
  return null;
}
