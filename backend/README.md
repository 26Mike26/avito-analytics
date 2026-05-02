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
- `GET /api/items` — список объявлений аккаунта.
- `GET /api/metrics?dateFrom=2026-04-01&dateTo=2026-04-30&itemIds=1,2,3` — статистика по дням.
- `POST /api/bid` — изменение ставки `{ itemId, bid }`.

## Как получить креденшелы

1. Зарегистрируйтесь на [developers.avito.ru](https://developers.avito.ru/).
2. Создайте приложение, получите Client ID и Client Secret.
3. Скопируйте их в `backend/.env`.
4. User ID — это ID вашего аккаунта на Авито (виден в личном кабинете).

## Подключение фронтенда

В `src/services/AvitoAdapter.ts` замените методы `fetchItems` / `fetchMetrics` / `updateBid`,
чтобы они ходили на `http://localhost:4000/api/...` вместо генерации mock-данных.
Пример:

```ts
async fetchItems(): Promise<AvitoItem[]> {
  if (this.settings.mode === 'api') {
    const res = await fetch('http://localhost:4000/api/items');
    if (!res.ok) throw new Error('API недоступен');
    const data = await res.json();
    return data.resources.map(mapAvitoItem); // адаптируйте маппинг
  }
  return generateMockItems();
}
```

## ⚠ Важно

Точные пути эндпоинтов Avito могут отличаться от указанных. Сверяйтесь с актуальной
документацией: [api-catalog](https://developers.avito.ru/api-catalog).
