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
}

/**
 * Адрес backend-прокси (Express), который умеет ходить в Avito API.
 * Если переменная не задана — режим API не работает (только demo и CSV).
 */
const PROXY_BASE = (import.meta.env?.VITE_AVITO_PROXY_URL ?? '')
  .toString()
  .replace(/\/$/, '');

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

export class AvitoAdapter implements IAvitoAdapter {
  constructor(private settings: IntegrationSettings) {}

  setSettings(settings: IntegrationSettings) {
    this.settings = settings;
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
        const data = await proxyFetch<{ resources?: unknown[] }>(
          '/api/items?status=active&per_page=100',
          this.headers()
        );
        const list = (data.resources ?? []) as Array<{
          id: number | string;
          title?: string;
          status?: string;
          category?: { name?: string };
          address?: string;
          price?: number;
          url?: string;
        }>;
        return list.map((it) => ({
          id: String(it.id),
          title: it.title ?? `Объявление ${it.id}`,
          status:
            it.status === 'removed' || it.status === 'closed'
              ? 'archived'
              : it.status === 'blocked'
              ? 'paused'
              : 'active',
          category: it.category?.name ?? 'Без категории',
          region: it.address ?? '—',
          price: Number(it.price ?? 0),
          currentBid: 0,
          recommendedBid: 0,
          views: 0,
          contacts: 0,
          favorites: 0,
          spend: 0,
          revenue: undefined,
          createdAt: new Date().toISOString().slice(0, 10),
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
        past.setDate(today.getDate() - 30);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const data = await proxyFetch<{ result?: { items?: unknown[] } }>(
          '/api/stats/items',
          {
            method: 'POST',
            ...this.headers(),
            body: JSON.stringify({
              dateFrom: fmt(past),
              dateTo: fmt(today),
              itemIds: items.map((i) => Number(i.id)).filter(Boolean),
              fields: ['views', 'uniqViews', 'contacts', 'favorites', 'spent'],
            }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const out: ItemMetrics[] = [];
        const list = (data.result?.items ?? []) as Array<{
          itemId?: number | string;
          stats?: Array<{
            date: string;
            views?: number;
            contacts?: number;
            favorites?: number;
            spent?: number;
          }>;
        }>;
        for (const row of list) {
          const id = String(row.itemId);
          for (const s of row.stats ?? []) {
            out.push({
              itemId: id,
              date: s.date,
              views: Number(s.views ?? 0),
              contacts: Number(s.contacts ?? 0),
              favorites: Number(s.favorites ?? 0),
              spend: Number(s.spent ?? 0),
              bid: 0,
            });
          }
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
          result?: { operations?: Array<{ updatedAt: string; type: string; amountTotal: number; serviceName?: string }> };
        }>(`/api/account/operations?${qs.toString()}`, this.headers());
        const ops = data.result?.operations ?? [];
        return ops.map((o) => ({
          timestamp: o.updatedAt,
          type:
            o.amountTotal > 0
              ? 'avito_balance_topup'
              : 'avito_balance_charge',
          title:
            o.amountTotal > 0
              ? 'Пополнение баланса Авито'
              : `Списание: ${o.serviceName ?? 'продвижение'}`,
          details: `Сумма: ${Math.abs(o.amountTotal)} ₽`,
        }));
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
