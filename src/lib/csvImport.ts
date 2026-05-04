import type { AvitoItem, ItemMetrics } from '../types';

/**
 * Парсер CSV/TSV выгрузок из личного кабинета Авито.
 *
 * Поддерживает два формата:
 *
 * 1. Сводный отчёт по объявлениям (одна строка = одно объявление):
 *    item_id, title, status, category, region, price, current_bid,
 *    views, contacts, favorites, spend, revenue, created_at
 *
 * 2. Отчёт по дням (одна строка = один день одного объявления):
 *    item_id, date, views, contacts, favorites, spend, bid
 *
 * Парсер сам определяет формат по наличию колонки `date`.
 * Если в файле обе сущности на разных листах, лучше выгружать их в два файла.
 */

export type CsvImportResult = {
  items: AvitoItem[];
  metrics: ItemMetrics[];
  warnings: string[];
  rowsProcessed: number;
  detectedFormat: 'items' | 'metrics' | 'unknown';
};

const ALIASES: Record<string, string[]> = {
  item_id: [
    'item_id',
    'id',
    'объявление',
    'id объявления',
    'avito_id',
    'номер объявления',
    'номер',
  ],
  title: ['title', 'название', 'заголовок', 'название объявления'],
  status: ['status', 'статус'],
  category: ['category', 'категория', 'подкатегория'],
  region: ['region', 'город', 'регион', 'регион размещения', 'location'],
  price: ['price', 'цена'],
  current_bid: ['current_bid', 'bid', 'ставка', 'cpc'],
  views: [
    'views',
    'просмотры',
    'impressions',
    'просмотрели',
    'просмотрело',
    'уник. просмотры',
    'уник просмотры',
    'unique views',
  ],
  impressions: ['показы'],
  contacts: [
    'contacts',
    'контакты',
    'обращения',
    'leads',
    'лиды',
    'количество контактов',
    'связались',
    'связались по телефону и в чат',
    'связались по телефону',
    'связались в чат',
    'позвонили',
    'написали',
    'откликнулись',
    'откликнулись на скидку в чате',
  ],
  favorites: ['favorites', 'избранное', 'fav', 'добавили в избранное'],
  spend: [
    'spend',
    'расход',
    'затраты',
    'cost',
    'расходы на объявления',
    'расходы',
    'расходы за период',
    'списано',
    'списано с баланса',
    'списано рублей',
    'spent',
    'spendings',
  ],
  revenue: ['revenue', 'выручка', 'доход'],
  created_at: [
    'created_at',
    'дата создания',
    'created',
    'дата первой публикации',
    'дата публикации',
  ],
  archived_at: ['дата снятия с публикации'],
  date: ['date', 'дата', 'day'],
};

function detectDelimiter(line: string): string {
  const candidates = [';', '\t', ','];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const cnt = line.split(c).length;
    if (cnt > bestCount) {
      bestCount = cnt;
      best = c;
    }
  }
  return best;
}

function parseLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '') // BOM
    .replace(/[«»"']/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIndexMap(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  const lower = headers.map(normalizeHeader);
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias);
      if (idx !== -1) {
        result[canonical] = idx;
        break;
      }
    }
  }
  return result;
}

const num = (v: string | undefined): number => {
  if (!v) return 0;
  const cleaned = v.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

const str = (v: string | undefined, fallback = ''): string =>
  (v ?? '').trim() || fallback;

function normalizeStatus(s: string): AvitoItem['status'] {
  const v = (s ?? '').toLowerCase();
  if (v.includes('активн') || v === 'active') return 'active';
  if (v.includes('пауз') || v === 'paused') return 'paused';
  if (v.includes('удал') || v.includes('снят') || v.includes('архив')) return 'archived';
  return v ? 'active' : 'active';
}

function inferStatus(
  archivedAt: string | undefined,
  title: string | undefined
): AvitoItem['status'] {
  const t = (title ?? '').toLowerCase();
  if (t.includes('удалено') || t.includes('снято с публикации')) return 'archived';
  if (archivedAt && archivedAt.trim()) return 'archived';
  return 'active';
}

export function parseCsvImport(text: string): CsvImportResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      items: [],
      metrics: [],
      warnings: ['Файл пуст или содержит только заголовки.'],
      rowsProcessed: 0,
      detectedFormat: 'unknown',
    };
  }

  const delim = detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delim);
  const idx = buildIndexMap(headers);

  if (idx.item_id === undefined) {
    warnings.push(
      'В файле нет колонки item_id (или его аналога: id, avito_id). Импорт невозможен.'
    );
    return {
      items: [],
      metrics: [],
      warnings,
      rowsProcessed: 0,
      detectedFormat: 'unknown',
    };
  }

  const isMetricsFormat = idx.date !== undefined;
  const items: AvitoItem[] = [];
  const itemsMap = new Map<string, AvitoItem>();
  const metrics: ItemMetrics[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i], delim);
    const itemId = str(cols[idx.item_id]);
    if (!itemId) continue;

    if (isMetricsFormat) {
      const date = str(cols[idx.date!]);
      if (!date) continue;
      metrics.push({
        itemId,
        date,
        views: num(cols[idx.views!]),
        contacts: num(cols[idx.contacts!]),
        favorites: num(cols[idx.favorites!]),
        spend: num(cols[idx.spend!]),
        bid: num(cols[idx.current_bid!]),
      });
      // если items не было — соберём заглушку
      if (!itemsMap.has(itemId)) {
        itemsMap.set(itemId, {
          id: itemId,
          title: str(cols[idx.title!], `Объявление ${itemId}`),
          status: 'active',
          category: str(cols[idx.category!], 'Без категории'),
          region: str(cols[idx.region!], '—'),
          price: num(cols[idx.price!]),
          currentBid: num(cols[idx.current_bid!]),
          recommendedBid: num(cols[idx.current_bid!]),
          views: 0,
          contacts: 0,
          favorites: 0,
          spend: 0,
          revenue: undefined,
          createdAt: str(cols[idx.created_at!], date),
        });
      }
      const it = itemsMap.get(itemId)!;
      it.views += num(cols[idx.views!]);
      it.contacts += num(cols[idx.contacts!]);
      it.favorites += num(cols[idx.favorites!]);
      it.spend += num(cols[idx.spend!]);
    } else {
      const title = str(cols[idx.title!], `Объявление ${itemId}`);
      const archivedAt = idx.archived_at !== undefined ? str(cols[idx.archived_at]) : '';
      const status = idx.status !== undefined
        ? normalizeStatus(str(cols[idx.status!]))
        : inferStatus(archivedAt, title);
      const bid = idx.current_bid !== undefined ? num(cols[idx.current_bid]) : 0;
      items.push({
        id: itemId,
        title,
        status,
        category: str(cols[idx.category!], 'Без категории'),
        region: str(cols[idx.region!], '—'),
        price: num(cols[idx.price!]),
        currentBid: bid,
        recommendedBid: bid,
        views: num(cols[idx.views!]),
        contacts: num(cols[idx.contacts!]),
        favorites: num(cols[idx.favorites!]),
        spend: num(cols[idx.spend!]),
        revenue:
          idx.revenue !== undefined ? num(cols[idx.revenue]) || undefined : undefined,
        createdAt: str(
          cols[idx.created_at!],
          new Date().toISOString().slice(0, 10)
        ),
      });
    }
  }

  const finalItems = isMetricsFormat ? Array.from(itemsMap.values()) : items;

  if (finalItems.length === 0) {
    warnings.push('Не удалось распарсить ни одной строки. Проверьте формат файла.');
  }

  // Подсветим отсутствующие важные колонки
  const checkCols = ['views', 'contacts', 'spend'];
  for (const c of checkCols) {
    if (idx[c] === undefined) {
      warnings.push(
        `В файле нет колонки «${c}» — соответствующие данные будут нулевыми.`
      );
    }
  }
  if (!isMetricsFormat && idx.current_bid === undefined) {
    warnings.push(
      'В выгрузке нет ставки — рекомендации по ставкам будут опираться на оценку «нет данных», пока вы не введёте текущую ставку вручную в карточке объявления.'
    );
  }

  return {
    items: finalItems,
    metrics,
    warnings,
    rowsProcessed: lines.length - 1,
    detectedFormat: isMetricsFormat ? 'metrics' : 'items',
  };
}
