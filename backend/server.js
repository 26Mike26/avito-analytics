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

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }
  if (!AVITO_CLIENT_ID || !AVITO_CLIENT_SECRET) {
    throw new Error(
      'AVITO_CLIENT_ID / AVITO_CLIENT_SECRET не заданы. Заполните backend/.env.'
    );
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AVITO_CLIENT_ID,
    client_secret: AVITO_CLIENT_SECRET,
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
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 86400) * 1000;
  return cachedToken;
}

/**
 * Универсальный fetch с авто-обновлением токена при 401.
 */
async function avitoFetch(path, init = {}, retried = false) {
  const token = await getAccessToken(retried);
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
    return avitoFetch(path, init, true);
  }
  if (!res.ok) {
    const err = new Error(`Avito API ${res.status} ${path}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ─────────────────────────── Системные ───────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    await getAccessToken();
    res.json({ ok: true, message: 'Подключение к Avito API работает.' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ─────────────────────────── Account / User ──────────────────────
// Раздел: user, accounts-hierarchy

app.get('/api/account/self', async (_req, res) => {
  try {
    res.json(await avitoFetch('/core/v1/accounts/self'));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.get('/api/account/balance', async (_req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    res.json(await avitoFetch(`/core/v1/accounts/${AVITO_USER_ID}/balance/`));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.get('/api/account/operations', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    const { dateFrom, dateTo } = req.query;
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('dateTimeFrom', String(dateFrom));
    if (dateTo) qs.set('dateTimeTo', String(dateTo));
    res.json(
      await avitoFetch(
        `/core/v1/accounts/operations_history/?${qs.toString()}`,
        { method: 'POST' }
      )
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// ─────────────────────────── Items / Объявления ──────────────────
// Раздел: item

app.get('/api/items', async (req, res) => {
  try {
    const { status = 'active', per_page = 25, page = 1 } = req.query;
    const qs = new URLSearchParams({
      per_page: String(per_page),
      page: String(page),
      status: String(status),
    });
    res.json(await avitoFetch(`/core/v1/items?${qs.toString()}`));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    res.json(await avitoFetch(`/core/v1/accounts/${AVITO_USER_ID}/items/${req.params.id}/`));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// ─────────────────────────── Stats / Аналитика ───────────────────
// Раздел: item (статистика)

app.post('/api/stats/items', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    const { dateFrom, dateTo, itemIds, fields } = req.body;
    res.json(
      await avitoFetch(`/stats/v1/accounts/${AVITO_USER_ID}/items`, {
        method: 'POST',
        body: JSON.stringify({
          dateFrom,
          dateTo,
          itemIds: itemIds ?? [],
          fields: fields ?? ['views', 'uniqViews', 'contacts', 'favorites', 'spent'],
        }),
      })
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.get('/api/stats/calls', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    const { dateFrom, dateTo } = req.query;
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('dateFrom', String(dateFrom));
    if (dateTo) qs.set('dateTo', String(dateTo));
    res.json(
      await avitoFetch(`/stats/v1/accounts/${AVITO_USER_ID}/calls/stats?${qs.toString()}`)
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// ─────────────────────────── Promotion / Продвижение ─────────────
// Раздел: promotion, cpxpromo, autostrategy

app.get('/api/promotion/services', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    const itemIds = req.query.itemIds;
    const qs = new URLSearchParams();
    if (itemIds) qs.set('itemIds', String(itemIds));
    res.json(
      await avitoFetch(`/core/v1/accounts/${AVITO_USER_ID}/promotion/list/?${qs.toString()}`)
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// CPA-цена целевого действия — установка / получение
app.get('/api/cpx/bids', async (_req, res) => {
  try {
    res.json(await avitoFetch('/cpxpromo/1/bids/get'));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.post('/api/cpx/bids/manual', async (req, res) => {
  try {
    res.json(
      await avitoFetch('/cpxpromo/1/bids/set', {
        method: 'POST',
        body: JSON.stringify(req.body),
      })
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// ─────────────────────────── Messenger / Чаты ────────────────────
// Раздел: messenger
// Listing chats (v2) и отправка сообщений (v1) — см. _api-ref/references/sections/messenger.md

app.get('/api/messenger/chats', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    const { limit = 50, offset = 0, unread_only } = req.query;
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (unread_only) qs.set('unread_only', 'true');
    res.json(
      await avitoFetch(`/messenger/v2/accounts/${AVITO_USER_ID}/chats?${qs.toString()}`)
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

app.post('/api/messenger/chats/:chatId/message', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан');
    res.json(
      await avitoFetch(
        `/messenger/v1/accounts/${AVITO_USER_ID}/chats/${req.params.chatId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'text',
            message: { text: req.body?.text ?? '' },
          }),
        }
      )
    );
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, body: e.body });
  }
});

// ─────────────────────────── Старт ───────────────────────────────

app.listen(PORT, () => {
  console.log(`Avito proxy: http://localhost:${PORT}`);
  console.log(
    AVITO_CLIENT_ID
      ? '✓ Креденшелы загружены из .env'
      : '⚠ .env пустой — токен не будет получен.'
  );
  console.log('Эндпоинты:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/account/self');
  console.log('  GET  /api/account/balance');
  console.log('  GET  /api/account/operations?dateFrom=...&dateTo=...');
  console.log('  GET  /api/items?status=active&per_page=25');
  console.log('  GET  /api/items/:id');
  console.log('  POST /api/stats/items   { dateFrom, dateTo, itemIds, fields }');
  console.log('  GET  /api/stats/calls?dateFrom=...&dateTo=...');
  console.log('  GET  /api/promotion/services?itemIds=...');
  console.log('  GET  /api/cpx/bids');
  console.log('  POST /api/cpx/bids/manual');
  console.log('  GET  /api/messenger/chats?unread_only=true');
  console.log('  POST /api/messenger/chats/:chatId/message  { text }');
});
