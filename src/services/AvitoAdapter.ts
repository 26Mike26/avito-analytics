import type {
  AvitoItem,
  IntegrationSettings,
  ItemMetrics,
} from '../types';
import {
  generateMetricsForItems,
  generateMockItems,
} from '../data/mock';
import { parseCsvImport, type CsvImportResult } from '../lib/csvImport';

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
}
