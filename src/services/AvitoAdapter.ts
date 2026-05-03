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

export class AvitoAdapter implements IAvitoAdapter {
  constructor(private settings: IntegrationSettings) {}

  setSettings(settings: IntegrationSettings) {
    this.settings = settings;
  }

  async fetchItems(): Promise<AvitoItem[]> {
    if (this.settings.mode === 'api') {
      // TODO: подключить реальный API
      // GET https://api.avito.ru/core/v1/items
      // Headers: Authorization: Bearer ${access_token}
      console.warn(
        '[AvitoAdapter] Режим API ещё не подключён. Возвращаем демо-данные.'
      );
      return generateMockItems();
    }
    if (this.settings.mode === 'csv') {
      // CSV импортируется отдельно через importCsv, базовые данные — demo
      return generateMockItems();
    }
    return generateMockItems();
  }

  async fetchMetrics(items: AvitoItem[]): Promise<ItemMetrics[]> {
    if (this.settings.mode === 'api') {
      // TODO: подключить реальный API
      // POST https://api.avito.ru/stats/v1/accounts/{user_id}/items
      console.warn(
        '[AvitoAdapter] Метод метрик ещё не подключён к API. Возвращаем демо-метрики.'
      );
      return generateMetricsForItems(items);
    }
    return generateMetricsForItems(items);
  }

  async updateBid(itemId: string, newBid: number): Promise<void> {
    if (this.settings.mode === 'api') {
      // TODO: подключить реальный API
      // POST https://api.avito.ru/cpxpromo/1/setMaxBid
      console.warn('[AvitoAdapter] updateBid: API не подключён.', { itemId, newBid });
      return;
    }
    // demo / csv — изменения только в локальном состоянии
    return;
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
    if (!this.settings.clientId || !this.settings.accessToken) {
      return {
        ok: false,
        message: 'Не заполнены Client ID или Access Token. Проверьте настройки.',
      };
    }
    // TODO: подключить реальный API
    return {
      ok: false,
      message:
        'Реальное подключение к Avito API ещё не реализовано во фронтенде. Используйте серверный прокси.',
    };
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
      // TODO: подключить реальный API через backend-прокси
      console.warn(
        '[AvitoAdapter] fetchAvitoEvents: API не подключён, возвращаем демо.'
      );
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
