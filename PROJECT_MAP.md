# PROJECT_MAP.md

Карта проекта avito-analytics. Цель — навигация без полного чтения кода.
Стек: React + TypeScript + Vite, react-router-dom, zustand, recharts, @supabase/supabase-js, Tailwind. Бэкенд — Express (`backend/server.js`).

## Корень
- `index.html`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js` — конфиг сборки.
- `vercel.json` — деплой.
- `setup.sh`, `SUPABASE_SETUP.md`, `README.md` — установка/доки.
- `supabase/` — миграции/схема Supabase.
- `dist/` — артефакт сборки (не редактировать).
- `docs/` — документация.

## backend/
- `server.js` — Express-сервер (прокси к Avito API, эндпоинты `/stats/...`). Запуск/проверка: `node --check server.js`.
- `.env` / `.env.example` — ключи.

## src/ — фронтенд

### src/pages/ — экраны (роуты)
- `Dashboard.tsx` (1238) — главная; precise-кэш (localStorage, scoped by period).
- `Analytics.tsx` — аналитика; `runPreciseCityCalc` + `cacheKeyRef`.
- `Compare.tsx` — сравнение периодов (Supabase-restore удалён).
- `Insights.tsx`, `Recommendations.tsx`, `KpiCenter.tsx` — производные метрики/рекомендации.
- `Items.tsx`, `ItemDetail.tsx` — объявления.
- `Bids.tsx` — ставки.
- `Accounts.tsx`, `ActionLog.tsx`, `Settings.tsx` — аккаунты, журнал, настройки.
- `Login.tsx`, `Signup.tsx` — авторизация.
- `pages/client/` — клиентские (read-only) версии: `ClientDashboard`, `ClientAnalytics`, `ClientActionLog`, `ClientRecommendations`.

### src/components/ — переиспользуемый UI
`Layout`, `Header` (search→Объявления), `Sidebar`, `AccountSwitcher`, `PeriodPicker`, `ProtectedRoute`, `KpiCard`, `Badge`, `ProgressBar`, `ConfirmDialog`, `ThemeToggle`, `Empty`.

### src/lib/ — бизнес-логика без UI
- `analytics.ts` (449) — расчёты метрик.
- `clientAnalytics.ts`, `clientAccess.ts`, `clientScope.ts` — логика клиентского режима.
- `compare.ts` — сравнение периодов.
- `insights.ts` (537), `recommendations.ts` (632) — генерация инсайтов/рекомендаций.
- `csvImport.ts` — импорт CSV.
- `download.ts` — единая утилита выгрузки файлов.

### src/services/ — внешние интеграции
- `AvitoAdapter.ts` (1646) — клиент Avito API.
- `Repository.ts` (541) — доступ к данным.
- `StatsCacheService.ts` (273) — кэш статистики.
- `AuthService.ts`, `supabase.ts` — авторизация и клиент Supabase.

### src/store/
- `useStore.ts` (1960) — глобальный стор zustand; пишет precise-статистику в Supabase.

### Прочее
- `src/types/index.ts` — типы.
- `src/data/mock.ts` — мок-данные.
- `src/App.tsx`, `src/main.tsx`, `src/index.css` — точка входа.

## Карта задач → файлы
- Precise-кэш (Supabase→localStorage): `Dashboard.tsx`, `Analytics.tsx`, `Compare.tsx`, `useStore.ts`, `StatsCacheService.ts`.
- Эффективность по категориям (#9 — учёт подкатегорий): искать в `lib/analytics.ts`, `lib/insights.ts`, `pages/Insights.tsx` / `KpiCenter.tsx`.
- Mobile-адаптация: `Layout`, `Header`, `Sidebar`, `AccountSwitcher`, `PeriodPicker`.
- Avito API / эндпоинты статистики: `backend/server.js`, `AvitoAdapter.ts`.
