import 'dotenv/config';
import express from 'express';
import cors from 'cors';

/**
 * Минимальный прокси-сервер для Avito API.
 *
 * Клиентский фронтенд (Vite, порт 5173) ходит сюда (порт 4000) — здесь же
 * хранятся креденшелы из .env. Прокси сам обновляет access_token и
 * пересылает запросы к https://api.avito.ru.
 *
 * Это заготовка. Точные эндпоинты Avito могут отличаться, проверяйте
 * актуальную документацию: https://developers.avito.ru/api-catalog
 */

const app = express();
app.use(cors());
app.use(express.json());

const {
  AVITO_CLIENT_ID,
  AVITO_CLIENT_SECRET,
  AVITO_USER_ID,
  PORT = 4000,
} = process.env;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
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
  const res = await fetch('https://api.avito.ru/token', {
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
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

async function avitoFetch(path, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.avito.ru${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Avito API ${res.status}: ${text}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

app.get('/api/health', async (_req, res) => {
  try {
    await getAccessToken();
    res.json({ ok: true, message: 'Подключение к Avito API работает.' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.get('/api/items', async (_req, res) => {
  try {
    // Документация: https://developers.avito.ru/api-catalog/item/documentation
    // Эндпоинт может быть /core/v1/items или /core/v1/accounts/{user_id}/items
    const data = await avitoFetch('/core/v1/items');
    res.json(data);
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    if (!AVITO_USER_ID) throw new Error('AVITO_USER_ID не задан в .env');
    const { dateFrom, dateTo, itemIds } = req.query;
    // Документация: https://developers.avito.ru/api-catalog/stats/documentation
    const data = await avitoFetch(`/stats/v1/accounts/${AVITO_USER_ID}/items`, {
      method: 'POST',
      body: JSON.stringify({
        dateFrom,
        dateTo,
        itemIds: itemIds ? String(itemIds).split(',').map(Number) : undefined,
        fields: ['views', 'contacts', 'favorites', 'spend'],
      }),
    });
    res.json(data);
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

app.post('/api/bid', async (req, res) => {
  try {
    const { itemId, bid } = req.body;
    if (!itemId || !bid) throw new Error('itemId и bid обязательны.');
    // Документация: https://developers.avito.ru/api-catalog/cpxpromo/documentation
    const data = await avitoFetch('/cpxpromo/1/setMaxBid', {
      method: 'POST',
      body: JSON.stringify({ itemId, bid }),
    });
    res.json(data);
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Avito proxy работает на http://localhost:${PORT}`);
  console.log(
    AVITO_CLIENT_ID
      ? '✓ Креденшелы загружены из .env'
      : '⚠ .env не заполнен — токен не будет получен.'
  );
});
