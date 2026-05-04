# Backend-прокси для Avito API

Минимальный сервер на Express, который получает access_token у Avito и пересылает запросы.
Креденшелы хранятся в `.env`, чтобы они не попали в браузер.

## Запуск

```bash
cd backend
cp .env.example .env
# открыть .env и заполнить AVITO_CLIENT_ID / AVITO_CLIENT_SECRET / AVITO_USER_ID
npm install
npm start
```

После старта прокси слушает `http://localhost:4000`.

## Эндпоинты

- `GET /api/health` — проверяет, что токен можно получить.
- `GET /api/items?status=active&per_page=100&page=1` — список объявлений аккаунта.
- `POST /api/stats/items` — дневные счётчики по объявлениям через `stats/v1`.
- `POST /api/stats/items-analytics` — показатели профиля через `stats/v2`, включая `spending` по объявлениям.
- `GET /api/account/operations` — история операций кошелька для баланса и расходов без объявления.
- `POST /api/cpx/bids/manual` — изменение ставки CPx `{ itemId, bid }`.

## Как получить креденшелы

1. Зарегистрируйтесь на [developers.avito.ru](https://developers.avito.ru/).
2. Создайте приложение, получите Client ID и Client Secret.
3. Скопируйте их в `backend/.env`.
4. User ID — это ID вашего аккаунта на Авито (виден в личном кабинете).

## Подключение фронтенда

Фронтенд уже ходит в этот прокси через `VITE_AVITO_PROXY_URL`.
Для расходов по конкретным объявлениям используется `stats/v2/accounts/{user_id}/items`
с метриками `spending`, `presenceSpending`, `promoSpending`, `commission`,
`restSpending`. История операций кошелька не используется как основной источник
per-item расхода, потому что она часто отдаёт только общий CPA/CPx-аванс.

## ⚠ Важно

Точные пути эндпоинтов Avito могут отличаться от указанных. Сверяйтесь с актуальной
документацией: [api-catalog](https://developers.avito.ru/api-catalog).
