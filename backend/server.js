import 'dotenv/config';
import express from 'express';
import cors from 'cors';

/**
 * Прокси-сервер для Avito Business API (https://api.avito.ru).
 *
 * Эндпоинты и поведение основаны на:
 *  - официальном каталоге developers.avito.ru/api-catalog
 *  - skill `MissiaL/avito-api` (см. ../_api-ref/SKILL.md и references/sections/*.md)
 *
 * Авторизация: OAuth2 Client Credentials. Токен живёт 24ч, кэшируется в памяти.
 * При 401 от Avito — перезапрашивается один раз и запрос повторяется.
 */

const app = express();
app.use(cors());
app.use(express.json());

const {
  AVITO_CLIENT_ID,
  AVITO_CLIENT_SECRET,
  AVITO_USER_ID, // обычно совпадает с id из /core/v1/accounts/self
  PORT = 4000,
} = process.env;

const AVITO_BASE = 'https://api.avito.ru';

/**
 * Реестр аккаунтов: userId → { clientId, clientSecret }.
 * Источников может быть три:
 *   1. .env — стартовая пара (AVITO_CLIENT_ID/SECRET/USER_ID)
 *   2. .env с префиксом AVITO_ACC_<USER_ID>_CLIENT_ID / _SECRET
 *      — для нескольких аккаунтов сразу
 *   3. Регистрация на лету через POST /api/accounts/register
 *      (полезно при разработке: фронт сам пушит креды на прокси)
 *
 * В проде кладите креды в Supabase / Vault, а сюда подсасывайте при старте.
 */
const accountRegistry = new Map();

if (AVITO_CLIENT_ID && AVITO_CLIENT_SECRET && AVITO_USER_ID) {
  accountRegistry.set(String(AVITO_USER_ID), {
    clientId: AVITO_CLIENT_ID,
    clientSecret: AVITO_CLIENT_SECRET,
  });
}
for (const [k, v] of Object.entries(process.env)) {
  const m = k.match(/^AVITO_ACC_([^_]+)_CLIENT_ID$/);
  if (!m) continue;
  const uid = m[1];
  const sec = process.env[`AVITO_ACC_${uid}_CLIENT_SECRET`];
  if (sec) accountRegistry.set(uid, { clientId: v, clientSecret: sec });
}

/** Кэш токенов: userId → { token, expiresAt }. */
const tokenCache = new Map();

function getAccountIdFromReq(req) {
  const fromHeader =
    req.get('x-avito-account-id') || req.get('x-avito-user-id');
  if (fromHeader) return String(fromHeader);
  if (AVITO_USER_ID) return String(AVITO_USER_ID);
  throw Object.assign(new Error('Не передан X-Avito-Account-Id'), { status: 400 });
}

async function getAccessTokenFor(accountId, forceRefresh = false) {
  const id = String(accountId);
  const creds = accountRegistry.get(id);
  if (!creds) {
    throw Object.assign(
      new Error(
        `Аккаунт ${id} не зарегистрирован на прокси. Добавьте AVITO_ACC_${id}_CLIENT_ID/SECRET в .env или вызовите POST /api/accounts/register.`
      ),
      { status: 404 }
    );
  }
  const cached = tokenCache.get(id);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(`${AVITO_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token error ${res.status}: ${text}`);
  }
  const data = await res.json();
  tokenCache.set(id, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
  });
  return data.access_token;
}

// Регистрация аккаунта на лету (для разработки).
// В проде защитите этот эндпоинт админ-токеном или уберите вовсе.
app.post('/api/accounts/register', (req, res) => {
  const { userId, clientId, clientSecret } = req.body ?? {};
  if (!userId || !clientId || !clientSecret) {
    return res
      .status(400)
      .json({ error: 'Нужны поля userId, clientId, clientSecret' });
  }
  accountRegistry.set(String(userId), { clientId, clientSecret });
  tokenCache.delete(String(userId));
  res.json({ ok: true, registered: String(userId) });
});

/**
 * Универсальный fetch с авто-обновлением токена при 401.
 * Креды выбираются по `accountId` (берётся из X-Avito-Account-Id или из .env).
 */
async function avitoFetch(accountId, path, init = {}, retried = false) {
  const token = await getAccessTokenFor(accountId, retried);
  const res = await fetch(`${AVITO_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  // 401 — токен истёк, обновим и повторим один раз
  if (res.status === 401 && !retried) {
    return avitoFetch(accountId, path, init, true);
  }
  if (!res.ok) {
    const err = new Error(`Avito API ${res.status} ${path}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}


function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

function normalizeImageUrl(candidate, baseUrl) {
  const cleaned = decodeHtmlEntities(candidate).trim();
  if (!cleaned) return undefined;
  try {
    return new URL(cleaned, baseUrl).href;
  } catch {
    return undefined;
  }
}

function extractImageFromHtml(html, pageUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /"image"\s*:\s*"([^"<]+)"/i,
    /"images"\s*:\s*\[\s*"([^"<]+)"/i,
    /(https?:\\?\/\\?\/[^"'<>\s]+\.(?:jpe?g|png|webp)(?:[^"'<>\s]*)?)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const url = match ? normalizeImageUrl(match[1], pageUrl) : undefined;
    if (url) return url;
  }
  return undefined;
}

function findImageUrlInObject(value) {
  const seen = new WeakSet();
  const scan = (input, depth, imageHint = false) => {
    if (depth > 8 || input == null) return undefined;
    if (typeof input === 'string') {
      const candidate = input.trim();
      const isUrl = /^https?:\/\//i.test(candidate);
      const hasImageExtension = /\.(jpe?g|png|webp)(\?|#|$)/i.test(candidate);
      return isUrl && (imageHint || hasImageExtension) ? candidate : undefined;
    }
    if (typeof input !== 'object') return undefined;
    if (seen.has(input)) return undefined;
    seen.add(input);
    if (Array.isArray(input)) {
      for (const item of input) {
        const found = scan(item, depth + 1, imageHint);
        if (found) return found;
      }
      return undefined;
    }
    const record = input;
    for (const key of [
      '_firstImageUrl',
      'firstImageUrl',
      'first_image_url',
      'imageUrl',
      'image_url',
      'imageUrls',
      'image_urls',
      'preview',
      'thumbnail',
      'small',
      'medium',
      'large',
      '140x105',
      '640x480',
      '1280x960',
    ]) {
      const found = scan(record[key], depth + 1, true);
      if (found) return found;
    }
    for (const key of ['images', 'photos', 'photo', 'image', 'pictures', 'resources']) {
      const found = scan(record[key], depth + 1, true);
      if (found) return found;
    }
    if (imageHint) {
      for (const [key, val] of Object.entries(record)) {
        const keyLooksLikeImage = /image|photo|picture|preview|thumbnail|url/i.test(key) || /^\d+x\d+$/.test(key);
        const found = scan(val, depth + 1, imageHint || keyLooksLikeImage);
        if (found) return found;
      }
    }
    return undefined;
  };
  return scan(value, 0);
}

function findAvitoItemUrl(value) {
  const seen = new WeakSet();
  const scan = (input, depth) => {
    if (depth > 6 || input == null) return undefined;
    if (typeof input === 'string') {
      const candidate = input.trim();
      return /^https?:\/\/(www\.)?avito\.ru\//i.test(candidate) ? candidate : undefined;
    }
    if (typeof input !== 'object') return undefined;
    if (seen.has(input)) return undefined;
    seen.add(input);
    if (Array.isArray(input)) {
      for (const item of input) {
        const found = scan(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = input;
    for (const key of ['url', 'itemUrl', 'item_url', 'link', 'uri']) {
      const found = scan(record[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return scan(value, 0);
}

async function fetchPublicItemImage(itemUrl) {
  if (!itemUrl || !/^https?:\/\/(www\.)?avito\.ru\//i.test(itemUrl)) return undefined;
  const res = await fetch(itemUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) return undefined;
  const html = await res.text();
  return extractImageFromHtml(html, itemUrl);
}

/** Маленький помощник: достаёт accountId из заголовка и оборачивает любые ошибки. */
function withAcc(handler) {
  return async (req, res) => {
    try {
      const accountId = getAccountIdFromReq(req);
      await handler(accountId, req, res);
    } catch (e) {
      res
        .status(e.status ?? 500)
        .json({ error: e.message, body: e.body });
    }
  };
}

// ─────────────────────────── Системные ───────────────────────────

app.get('/api/health', withAcc(async (accountId, _req, res) => {
  await getAccessTokenFor(accountId);
  res.json({
    ok: true,
    message: `Подключение к Avito API работает (аккаунт ${accountId}).`,
  });
}));

// Список зарегистрированных аккаунтов (без секретов).
app.get('/api/accounts', (_req, res) => {
  res.json({
    accounts: Array.from(accountRegistry.entries()).map(([id, c]) => ({
      userId: id,
      clientId: c.clientId,
    })),
  });
});

// ─────────────────────────── Account / User ──────────────────────
// Раздел: user, accounts-hierarchy

app.get('/api/account/self', withAcc(async (accountId, _req, res) => {
  res.json(await avitoFetch(accountId, '/core/v1/accounts/self'));
}));

app.get('/api/account/balance', withAcc(async (accountId, _req, res) => {
  res.json(
    await avitoFetch(accountId, `/core/v1/accounts/${accountId}/balance/`)
  );
}));

// CPA-аванс — отдельная ручка, не возвращается в /balance/.
// Если у пользователя нет CPA — Avito ответит 404, мы это глотаем.
app.get('/api/account/cpa-balance', withAcc(async (accountId, _req, res) => {
  try {
    res.json(await avitoFetch(accountId, `/cpxpromo/1/balanceInfo`));
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      // CPA не подключён к аккаунту — это норма, отдаём нули
      res.json({ result: { balance: 0, advance: 0 }, _note: 'CPA не подключён' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

app.get('/api/account/operations', withAcc(async (accountId, req, res) => {
  const { dateFrom, dateTo } = req.query;
  // Avito ждёт ISO 8601 c временем И тело JSON (НЕ query). Без этого 400 invalid content type.
  res.json(
    await avitoFetch(
      accountId,
      `/core/v1/accounts/operations_history/`,
      {
        method: 'POST',
        body: JSON.stringify({
          dateTimeFrom: String(dateFrom ?? ''),
          dateTimeTo: String(dateTo ?? ''),
        }),
      }
    )
  );
}));

// ─────────────────────────── Items / Объявления ──────────────────
// Раздел: item

app.get('/api/items', withAcc(async (accountId, req, res) => {
  const { status = 'active', per_page = 25, page = 1 } = req.query;
  const qs = new URLSearchParams({
    per_page: String(per_page),
    page: String(page),
    status: String(status),
  });
  res.json(await avitoFetch(accountId, `/core/v1/items?${qs.toString()}`));
}));

app.get('/api/items/:id', withAcc(async (accountId, req, res) => {
  const detail = await avitoFetch(
    accountId,
    `/core/v1/accounts/${accountId}/items/${req.params.id}/`
  );
  let imageUrl = findImageUrlInObject(detail);
  if (!imageUrl) {
    const publicUrl = typeof req.query.url === 'string' ? req.query.url : findAvitoItemUrl(detail);
    try {
      imageUrl = await fetchPublicItemImage(publicUrl);
    } catch (e) {
      console.warn('[items:image] public fallback failed:', e.message);
    }
  }
  if (imageUrl && detail && typeof detail === 'object' && !Array.isArray(detail)) {
    res.json({ ...detail, _firstImageUrl: imageUrl });
    return;
  }
  res.json(detail);
}));

// ─────────────────────────── Stats / Аналитика ───────────────────
// Раздел: item (статистика)

app.post('/api/stats/items', withAcc(async (accountId, req, res) => {
  const { dateFrom, dateTo, itemIds, fields } = req.body;
  res.json(
    await avitoFetch(
      accountId,
      `/stats/v1/accounts/${accountId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({
          dateFrom,
          dateTo,
          itemIds: itemIds ?? [],
          fields: fields ?? ['uniqViews', 'contacts', 'favorites'],
        }),
      }
    )
  );
}));

// In-memory кэш для /stats/v2 — 60 секунд per (accountId, dateFrom, dateTo, itemIds).
// Avito жёстко ограничивает rate (429), кэш экономит запросы.
const v2Cache = new Map(); // key → { ts, data }
const V2_TTL_MS = 60_000;
function v2CacheKey(accountId, body) {
  return [
    accountId,
    body.dateFrom,
    body.dateTo,
    (body.itemIds ?? []).join(','),
    (body.fields ?? []).join(','),
    body.periodGrouping ?? '',
  ].join('|');
}

// /stats/v2 — новая версия: МОЖЕТ возвращать per-item расход и показы.
// Не у всех тарифов работает. Если Avito возвращает 400/404/429/500 —
// проксируем как HTTP 200 с {_v2_unavailable: true}, чтобы Network не светилась.
app.post('/api/stats/items/v2', withAcc(async (accountId, req, res) => {
  const { dateFrom, dateTo, itemIds, fields, metrics, grouping } = req.body;
  const requestedMetrics = metrics ?? fields ?? ['views', 'impressions', 'contacts', 'favorites', 'allSpending'];
  const legacyBody = {
    dateFrom,
    dateTo,
    itemIds: itemIds ?? [],
    fields: requestedMetrics,
    periodGrouping: 'day',
  };
  // Проверяем кэш
  const key = v2CacheKey(accountId, {
    ...legacyBody,
    grouping: grouping ?? '',
    metrics: requestedMetrics,
  });
  const cached = v2Cache.get(key);
  if (cached && Date.now() - cached.ts < V2_TTL_MS) {
    res.json(cached.data);
    return;
  }
  try {
    let result;

    if (grouping === 'item' || metrics) {
      const requestedItemIds = new Set((itemIds ?? []).map((id) => String(id)));
      const allItems = [];
      for (let offset = 0; offset < 5000; offset += 1000) {
        const analyticsBody = {
          dateFrom,
          dateTo,
          grouping: 'item',
          metrics: requestedMetrics,
          limit: 1000,
          offset,
        };
        const page = await avitoFetch(
          accountId,
          `/stats/v2/accounts/${accountId}/items`,
          { method: 'POST', body: JSON.stringify(analyticsBody) }
        );
        const groups = page.result?.groupings ?? [];
        for (const group of groups) {
          const id = String(group.id ?? '');
          if (requestedItemIds.size > 0 && !requestedItemIds.has(id)) continue;
          const bySlug = new Map((group.metrics ?? []).map((m) => [m.slug, Number(m.value ?? 0)]));
          allItems.push({
            itemId: id,
            stats: [
              {
                date: dateTo,
                views: bySlug.get('views') ?? 0,
                impressions: bySlug.get('impressions') ?? 0,
                contacts: bySlug.get('contacts') ?? 0,
                favorites: bySlug.get('favorites') ?? 0,
                spent:
                  bySlug.get('allSpending') != null
                    ? Number(bySlug.get('allSpending')) / 100
                    : Number(bySlug.get('spent') ?? 0),
              },
            ],
          });
        }
        const total = Number(page.result?.dataTotalCount ?? groups.length);
        if (groups.length < 1000 || offset + groups.length >= total) break;
      }
      result = { result: { items: allItems } };
    } else {
      result = await avitoFetch(
        accountId,
        `/stats/v2/accounts/${accountId}/items`,
        { method: 'POST', body: JSON.stringify(legacyBody) }
      );
    }

    v2Cache.set(key, { ts: Date.now(), data: result });
    // Не даём кэшу неограниченно расти — простая очистка
    if (v2Cache.size > 200) {
      const oldest = [...v2Cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) v2Cache.delete(oldest[0]);
    }
    res.json(result);
  } catch (e) {
    // 429 особенно частый — кэшируем «недоступность» на 30 секунд,
    // чтобы фронт за это время не дёргал лишний раз
    const stub = {
      _v2_unavailable: true,
      error: e.message,
      status: e.status ?? 500,
    };
    if (e.status === 429) {
      v2Cache.set(key, { ts: Date.now() - (V2_TTL_MS - 30_000), data: stub });
    }
    res.json(stub);
  }
}));

// ─── Расходы профиля по типам (promotion / presence / commission / rest)
// Точная цифра из Avito Pro Статистика → Расходы. Rate limit: 1/мин.
// Кэшируем на 60 сек как и /stats/v2.
const spendingsCache = new Map();
const SPENDINGS_TTL_MS = 60_000;
const SPENDINGS_RETRY_DELAY_MS = 65_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alternateSpendingsFilter(filter) {
  if (!filter) return null;
  if (Array.isArray(filter.itemIds)) {
    const next = { ...filter, itemIDs: filter.itemIds };
    delete next.itemIds;
    return next;
  }
  if (Array.isArray(filter.itemIDs)) {
    const next = { ...filter, itemIds: filter.itemIDs };
    delete next.itemIDs;
    return next;
  }
  return null;
}

app.post('/api/stats/spendings', withAcc(async (accountId, req, res) => {
  const { dateFrom, dateTo, grouping = 'day', spendingTypes, filter } = req.body;
  const types = spendingTypes ?? ['promotion', 'presence', 'commission', 'rest'];
  const key = [
    accountId,
    dateFrom,
    dateTo,
    grouping,
    types.join(','),
    JSON.stringify(filter ?? {}),
  ].join('|');
  const cached = spendingsCache.get(key);
  if (cached && Date.now() - cached.ts < SPENDINGS_TTL_MS) {
    res.json(cached.data);
    return;
  }
  const requestSpendings = (requestFilter) => {
    const body = { dateFrom, dateTo, grouping, spendingTypes: types };
    if (requestFilter) body.filter = requestFilter;
    return avitoFetch(
      accountId,
      `/stats/v2/accounts/${accountId}/spendings`,
      { method: 'POST', body: JSON.stringify(body) }
    );
  };

  const requestWithFilterFallback = async () => {
    try {
      return await requestSpendings(filter);
    } catch (e) {
      const fallbackFilter = alternateSpendingsFilter(filter);
      if (e.status === 400 && fallbackFilter) {
        return requestSpendings(fallbackFilter);
      }
      throw e;
    }
  };

  try {
    let result;
    try {
      result = await requestWithFilterFallback();
    } catch (e) {
      if (e.status !== 429) throw e;
      await sleep(SPENDINGS_RETRY_DELAY_MS);
      result = await requestWithFilterFallback();
    }
    spendingsCache.set(key, { ts: Date.now(), data: result });
    if (spendingsCache.size > 100) {
      const oldest = [...spendingsCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) spendingsCache.delete(oldest[0]);
    }
    res.json(result);
  } catch (e) {
    if (e.status === 429) {
      const stub = { _spendings_unavailable: true, error: 'rate_limit', status: 429 };
      spendingsCache.set(key, { ts: Date.now() - (SPENDINGS_TTL_MS - 30_000), data: stub });
      res.json(stub);
      return;
    }
    if (e.status === 404 || e.status === 403) {
      res.json({ _spendings_unavailable: true, error: 'не подключено', status: e.status });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

app.get('/api/stats/calls', withAcc(async (accountId, req, res) => {
  const { dateFrom, dateTo } = req.query;
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('dateFrom', String(dateFrom));
  if (dateTo) qs.set('dateTo', String(dateTo));
  res.json(
    await avitoFetch(
      accountId,
      `/stats/v1/accounts/${accountId}/calls/stats?${qs.toString()}`
    )
  );
}));

// ─────────────────────────── Promotion / Продвижение ─────────────
// Раздел: promotion, cpxpromo, autostrategy

app.get('/api/promotion/services', withAcc(async (accountId, req, res) => {
  try {
    const itemIds = req.query.itemIds;
    const qs = new URLSearchParams();
    if (itemIds) qs.set('itemIds', String(itemIds));
    res.json(
      await avitoFetch(
        accountId,
        `/core/v1/accounts/${accountId}/promotion/list/?${qs.toString()}`
      )
    );
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ result: { items: [] }, _note: 'нет применённых услуг' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

// CPA-цена целевого действия — установка / получение.
// Если у аккаунта не подключён CPA — Avito ответит 404. Не светим красным.
app.get('/api/cpx/bids', withAcc(async (accountId, _req, res) => {
  try {
    res.json(await avitoFetch(accountId, '/cpxpromo/1/bids/get'));
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ result: { bids: [] }, _note: 'CPA не подключён' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

// Батчевый запрос ставок per-item: до 200 объявлений за раз.
// Возвращает manualPromotion.bidPenny (в копейках) и autoPromotion.budgetPenny.
app.post('/api/cpx/promotions', withAcc(async (accountId, req, res) => {
  try {
    const { itemIds } = req.body;
    res.json(
      await avitoFetch(accountId, '/cpxpromo/1/getPromotionsByItemIds', {
        method: 'POST',
        body: JSON.stringify({ itemIDs: (itemIds ?? []).slice(0, 200) }),
      })
    );
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ items: [], _note: 'CPx не подключён' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

// CPA-баланс v3 — точный остаток CPA-аванса.
app.post('/api/cpa/balance', withAcc(async (accountId, _req, res) => {
  try {
    res.json(await avitoFetch(accountId, '/cpa/v3/balanceInfo', { method: 'POST', body: '{}' }));
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ balance: 0, _note: 'CPA не подключён' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

// Список автостратегических кампаний (для последующего getStat по campaignId).
app.post('/api/autostrategy/campaigns', withAcc(async (accountId, _req, res) => {
  try {
    res.json(await avitoFetch(accountId, '/autostrategy/v1/campaigns', { method: 'POST', body: '{}' }));
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ campaigns: [], _note: 'автостратегия не подключена' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

// Статистика по конкретной кампании автостратегии (расходы per-item возможны).
app.post('/api/autostrategy/stat', withAcc(async (accountId, req, res) => {
  try {
    const { campaignId } = req.body;
    res.json(
      await avitoFetch(accountId, '/autostrategy/v1/stat', {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      })
    );
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ items: [], _note: 'нет данных' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

app.post('/api/cpx/bids/manual', withAcc(async (accountId, req, res) => {
  res.json(
    await avitoFetch(accountId, '/cpxpromo/1/bids/set', {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
  );
}));

// ─────────────────────────── Messenger / Чаты ────────────────────
// Раздел: messenger

app.get('/api/messenger/chats', withAcc(async (accountId, req, res) => {
  const { limit = 50, offset = 0, unread_only } = req.query;
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (unread_only) qs.set('unread_only', 'true');
  res.json(
    await avitoFetch(
      accountId,
      `/messenger/v2/accounts/${accountId}/chats?${qs.toString()}`
    )
  );
}));

app.post('/api/messenger/chats/:chatId/message', withAcc(async (accountId, req, res) => {
  res.json(
    await avitoFetch(
      accountId,
      `/messenger/v1/accounts/${accountId}/chats/${req.params.chatId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'text',
          message: { text: req.body?.text ?? '' },
        }),
      }
    )
  );
}));

// ─────────────────────────── Старт ───────────────────────────────

app.listen(PORT, () => {
  console.log(`Avito proxy: http://localhost:${PORT}`);
  if (accountRegistry.size === 0) {
    console.log(
      '⚠ Реестр аккаунтов пуст. Добавьте AVITO_CLIENT_ID/SECRET/USER_ID в .env\n' +
        '  или зарегистрируйте аккаунт через POST /api/accounts/register.'
    );
  } else {
    console.log(`✓ Зарегистрировано аккаунтов: ${accountRegistry.size}`);
    for (const [id] of accountRegistry) console.log(`    • userId=${id}`);
  }
  console.log('Все ручки требуют заголовок X-Avito-Account-Id (или AVITO_USER_ID в .env).');
  console.log('Эндпоинты:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/accounts');
  console.log('  POST /api/accounts/register   { userId, clientId, clientSecret }');
  console.log('  GET  /api/account/self');
  console.log('  GET  /api/account/balance');
  console.log('  GET  /api/account/operations?dateFrom=...&dateTo=...');
  console.log('  GET  /api/items?status=active&per_page=25');
  console.log('  GET  /api/items/:id');
  console.log('  POST /api/stats/items   { dateFrom, dateTo, itemIds, fields }');
  console.log('  POST /api/stats/items/v2 { dateFrom, dateTo, itemIds, fields } — опц., per-item spend');
  console.log('  GET  /api/stats/calls?dateFrom=...&dateTo=...');
  console.log('  GET  /api/promotion/services?itemIds=...');
  console.log('  GET  /api/cpx/bids');
  console.log('  POST /api/cpx/bids/manual');
  console.log('  GET  /api/messenger/chats?unread_only=true');
  console.log('  POST /api/messenger/chats/:chatId/message  { text }');
});
