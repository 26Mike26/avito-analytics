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
  res.json(
    await avitoFetch(
      accountId,
      `/core/v1/accounts/${accountId}/items/${req.params.id}/`
    )
  );
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
          fields:
            fields ?? ['uniqViews', 'uniqContacts', 'uniqFavorites'],
        }),
      }
    )
  );
}));

// In-memory кэш для /stats/v2 — 60 секунд per (accountId, dateFrom, dateTo, grouping, filter).
// Avito жёстко ограничивает rate (429), кэш экономит запросы.
const v2Cache = new Map(); // key → { ts, data }
const V2_TTL_MS = 60_000;
function v2CacheKey(accountId, body) {
  return [
    accountId,
    body.dateFrom,
    body.dateTo,
    body.grouping ?? '',
    (body.metrics ?? []).join(','),
    JSON.stringify(body.filter ?? {}),
    JSON.stringify(body.sort ?? {}),
    body.limit ?? '',
    body.offset ?? '',
  ].join('|');
}

// /stats/v2 — профильная аналитика: умеет отдавать расходы по объявлениям
// (spending, presenceSpending, promoSpending, allSpending) в копейках.
// Не у всех тарифов работает. Если Avito возвращает 400/404/429/500 —
// проксируем как HTTP 200 с {_v2_unavailable: true}, чтобы Network не светилась.
app.post('/api/stats/items/v2', withAcc(async (accountId, req, res) => {
  const {
    dateFrom,
    dateTo,
    itemIds,
    fields,
    metrics,
    grouping = 'item',
    filter,
    sort,
    limit = 1000,
    offset = 0,
  } = req.body;
  const itemFilter = Array.isArray(itemIds) && itemIds.length > 0
    ? { itemIds: itemIds.map(Number).filter(Number.isFinite) }
    : undefined;
  const realMetrics = metrics ??
    fields ?? [
      'views',
      'contacts',
      'favorites',
      'spending',
      'presenceSpending',
      'promoSpending',
      'allSpending',
    ];
  const body = {
    dateFrom,
    dateTo,
    grouping,
    metrics: realMetrics,
    limit: Math.min(Number(limit) || 1000, 1000),
    offset: Math.max(Number(offset) || 0, 0),
    ...(filter || itemFilter ? { filter: { ...(filter ?? {}), ...(itemFilter ?? {}) } } : {}),
    ...(sort ? { sort } : {}),
  };
  // Проверяем кэш
  const key = v2CacheKey(accountId, body);
  const cached = v2Cache.get(key);
  if (cached && Date.now() - cached.ts < V2_TTL_MS) {
    res.json(cached.data);
    return;
  }
  try {
    const result = await avitoFetch(
      accountId,
      `/stats/v2/accounts/${accountId}/items`,
      { method: 'POST', body: JSON.stringify(body) }
    );
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
  const itemIds = req.query.itemIds;
  const qs = new URLSearchParams();
  if (itemIds) qs.set('itemIds', String(itemIds));
  res.json(
    await avitoFetch(
      accountId,
      `/core/v1/accounts/${accountId}/promotion/list/?${qs.toString()}`
    )
  );
}));

// CPA-цена целевого действия — установка / получение.
// Если у аккаунта не подключён CPA — Avito ответит 404. Не светим красным.
app.get('/api/auction/bids', withAcc(async (accountId, req, res) => {
  try {
    const fromItemID = Math.max(Number(req.query.fromItemID ?? 0) || 0, 0);
    const batchSize = Math.min(
      Math.max(Number(req.query.batchSize ?? 200) || 200, 1),
      200
    );
    const qs = new URLSearchParams({
      fromItemID: String(fromItemID),
      batchSize: String(batchSize),
    });
    res.json(await avitoFetch(accountId, `/auction/1/bids?${qs.toString()}`));
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      res.json({ items: [], _note: 'CPA-аукцион не подключён' });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
}));

app.post('/api/auction/bids', withAcc(async (accountId, req, res) => {
  const source = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = source.slice(0, 200).flatMap((row) => {
    const itemID = Number(row.itemID ?? row.itemId);
    const pricePenny = Number(row.pricePenny ?? row.bidPenny);
    if (!Number.isFinite(itemID) || !Number.isFinite(pricePenny)) return [];
    return [{
      itemID,
      pricePenny: Math.max(1, Math.round(pricePenny)),
      ...(row.expirationTime === undefined
        ? {}
        : { expirationTime: row.expirationTime }),
    }];
  });
  if (items.length === 0) {
    res.status(400).json({ error: 'Нужен items[] с itemID и pricePenny' });
    return;
  }
  res.json(
    await avitoFetch(accountId, '/auction/1/bids', {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
  );
}));

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
  console.log('  POST /api/stats/items/v2 { dateFrom, dateTo, itemIds, metrics, grouping } — опц., per-item spend');
  console.log('  GET  /api/stats/calls?dateFrom=...&dateTo=...');
  console.log('  GET  /api/promotion/services?itemIds=...');
  console.log('  GET  /api/auction/bids?fromItemID=0&batchSize=200');
  console.log('  POST /api/auction/bids        { items: [{ itemID, pricePenny }] }');
  console.log('  GET  /api/cpx/bids');
  console.log('  POST /api/cpx/bids/manual');
  console.log('  GET  /api/messenger/chats?unread_only=true');
  console.log('  POST /api/messenger/chats/:chatId/message  { text }');
});
