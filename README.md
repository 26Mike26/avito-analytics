# Avito Аналитика — управление ставками и рекомендации

Веб-сервис для анализа аккаунтов Авито: дашборд, KPI-центр, объявления, карточка
объявления, массовое управление ставками, рекомендации, аналитика, мульти-аккаунт,
журнал действий и настройки интеграции. Полностью на русском, фирменный стиль
агентства Genesis Group.

## Два режима работы

Приложение умеет работать в двух режимах — выбор делается через переменные окружения:

- **Локальный демо** (по умолчанию, без `.env`): данные хранятся в localStorage браузера.
  Подходит для одного устройства, презентаций и оффлайн-экспериментов.
- **Облачный SaaS** (Supabase): мульти-пользователь, синхронизация между устройствами,
  настоящий Auth, RLS-изоляция данных. Включается автоматически, когда заданы
  `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.

> Полная пошаговая инструкция по подключению Supabase и публикации на Vercel
> — в файле **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**.

## Стек

- React 18 + TypeScript, Vite
- Tailwind CSS, Lucide, Recharts
- Zustand для состояния
- React Router
- Supabase (Auth + Postgres + RLS) — опционально

## Локальный запуск (одной командой)

```bash
cd avito-analytics
chmod +x setup.sh
./setup.sh
```

Скрипт проверит Node.js, спросит ключи Supabase (можно оставить пустыми — будет локальный режим), поставит зависимости. После него — `npm run dev`.

## Деплой одним кликом (после Supabase)

1. Залейте репозиторий на GitHub.
2. Замените `<USER>/<REPO>` ниже на ваш путь и откройте ссылку — Vercel сам всё клонирует и спросит две переменные:

```
https://vercel.com/new/clone?repository-url=https://github.com/<USER>/<REPO>&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY&envDescription=Ключи%20из%20Supabase%20Settings%20%E2%86%92%20API
```

После клика — Vercel импортирует проект, попросит вставить значения `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, и через 1–2 минуты выдаст публичный URL.

## Возможности

- **Авторизация и профиль.** Регистрация по email/паролю. В Supabase — настоящий Auth,
  в локальном — SHA-256 + соль в localStorage.
- **Несколько аккаунтов в профиле.** Переключатель в шапке + страница «Аккаунты».
- **Журнал действий.** Все мутации логируются (вход/выход, импорт CSV, изменение KPI и
  ставок, принятие/отклонение рекомендаций, смена настроек). Фильтры, поиск, экспорт CSV.
- **Рекомендации по ставкам с уверенностью.** Анализ тренда за 7 дней, медиана по
  категории, расчёт уверенности (high/medium/low), объяснение «потому что A, B, C» и
  денежный прогноз.
- **Импорт CSV из личного кабинета Авито.** Парсер понимает русские заголовки.
- **Заготовка backend-прокси к Avito API** — папка `backend/`.

## Архитектура (для разработчиков)

- `src/types` — типы (`User, Account, AvitoItem, ItemMetrics, Recommendation, ActionLogEntry`).
- `src/data/mock.ts` — генератор демо-данных.
- `src/lib/analytics.ts` — формулы (CPL, CR, ROI, ROAS, бюджет, KPI), агрегаты.
- `src/lib/recommendations.ts` — движок рекомендаций.
- `src/lib/csvImport.ts` — парсер CSV/TSV.
- `src/services/supabase.ts` — singleton клиент. Активен, если есть env-переменные.
- `src/services/AuthService.ts` — единый интерфейс auth (Supabase или localStorage).
- `src/services/Repository.ts` — CRUD для accounts/items/metrics/bid_history/notes/log
  (Supabase или no-op для локального режима).
- `src/services/AvitoAdapter.ts` — интеграция с Avito (demo / api / csv).
- `src/store/useStore.ts` — Zustand-стор. В режиме Supabase каждая мутация дублируется
  в БД через `repository.*`, при логине данные грузятся из Supabase.
- `src/pages/*` — все экраны.
- `supabase/schema.sql` — миграции БД с RLS.
- `backend/` — заготовка Avito-прокси на Express.

## Деплой

Подробно: **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**.

Кратко: репозиторий → Vercel → добавить `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`
в Environment Variables → Deploy. Получите публичный URL.

## Безопасность

- Пароли в Supabase хешируются на стороне сервиса (Auth-провайдер).
- Доступ к данным защищён RLS — пользователь видит только свои строки даже через
  прямой запрос к API.
- Секреты Avito (`Client Secret`, `Access Token`) сейчас хранятся в `accounts` plain.
  Для прода включите шифрование `pgsodium` или вынесите чтение на серверную Edge Function.
- В прототипе Login/Signup честно предупреждают: «для боевого Auth — серверный прокси».

## Частые вопросы

См. секцию «Если что-то пошло не так» в `SUPABASE_SETUP.md`.
