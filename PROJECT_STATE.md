# PROJECT_STATE.md

## Current objective
Раздел «Клиенты» (доступ по токен-ссылке к кабинету `/client`) — выполнен, задеплоен на genesis-avito.ru и протестирован вживую: создание доступа, вход по ссылке (кабинет скоупится на выбранные аккаунты, read-only), отзыв — всё работает, ошибок в консоли нет.

## Changed files
Codex (HEAD~12..HEAD): Dashboard.tsx, Analytics.tsx, Compare.tsx, Header.tsx, Sidebar.tsx, AccountSwitcher.tsx, Layout.tsx, PeriodPicker.tsx, ActionLog.tsx, Items.tsx, Settings.tsx, Recommendations.tsx, KpiCenter.tsx, ItemDetail.tsx, Bids.tsx, Insights.tsx, Accounts.tsx, Login.tsx, Signup.tsx; новый src/lib/download.ts.

## Completed changes
- Раздел «Клиенты» (фикс затрат): токен-клиент видел приблизительные затраты — у него не было доступа к точной статистике (`item_daily_stats`/`account_daily_spend`, RLS только для авторизованных). Добавлен RPC `client_share_period(token, from, to)` (SECURITY DEFINER, grant anon) — отдаёт точную дневную статистику за период. В сторе: флаг `clientShareToken`, действие `refreshClientSharePeriod` (гидрирует periodCache из RPC через buildCachedPeriodData), вызывается в `bootstrap`/`setAnalyticsPeriod`. `ClientShareService.loadSharedPeriod`. `ClientDashboard`: «Обновить данные за период» в токен-режиме идёт через RPC, а не syncAllApiAccounts (read-only клиент API не синкает).
- Раздел «Клиенты» (этап 1): тип `ClientShare`/`ClientShareStatus` в types/index.ts; `services/ClientShareService.ts`; компонент `components/ClientsPanel.tsx`; вкладка «Аккаунты | Клиенты» в Accounts.tsx. Доступ по ссылке `/client?ct=<token>`, права фиксированные.
- Раздел «Клиенты» (этап 2): новый `supabase/client_shares.sql` (таблица + RLS владельца + SECURITY DEFINER RPC `resolve_client_share` и `client_share_accounts`, секреты интеграции вычищены, grant anon). `ClientShareService` переведён на async + dual-mode (Supabase ↔ localStorage-fallback) + хелперы токена. `ClientsPanel` адаптирован под async. `useStore.bootstrap()` резолвит токен `ct` (URL/localStorage) и собирает синтетическую клиентскую сессию; `logout` чистит токен. Маршрут `/c/:token` в App.tsx.
- #9: эффективность по категориям группируется по подкатегории (subcategoryName) в recommendations.ts (categoryWinners, computeCategoryStats, calculateBidRecommendation) и ItemDetail.tsx (исправлен баг лукапа categoryAverages по сырой category).
- Precise-статистика: чтение Supabase → localStorage-кэш (scoped by period) в Dashboard/Analytics/Compare. Store по-прежнему пишет в Supabase.
- Mobile-адаптация: sidebar, header, account switcher, compare-кнопки, responsive-гриды.
- Header search подключён к Объявлениям. Confirm logout. Единая утилита download.ts.
- Ранее (до Codex): /stats/v2/spendings, точный расчёт городов/топ-10 по filter.itemIDs, CTR=views/impressions, светлая тема, реактивные графики.
- tsc --noEmit чистый, backend node --check OK.

## Current risks
- Косметика: если владелец залогинен в том же браузере, открытие отозванной/невалидной ссылки `/client?ct=...` показывает client-хром (путь `/client`), но с данными владельца. Для внешнего клиента без сессии — редирект на `/login`. Не security-проблема, но можно отполировать.
- ClientActionLog у токен-клиента пустой: RPC `client_share_accounts` не возвращает журнал.
- В таблице `client_shares` остался тестовый отозванный доступ «Тестовый клиент» — можно удалить из вкладки «Клиенты».
- Фикс затрат: RPC `client_share_period` применён в Supabase. Код-изменения (useStore/ClientShareService/ClientDashboard) ещё НЕ задеплоены — нужен git push.
- Precise-данные не синхронизируются между устройствами: store пишет в Supabase, страницы читают только localStorage.
- localStorage-кэш растёт без TTL (ключи по периодам).

## Next action
1. Задеплоить фикс затрат: с Mac `rm -f .git/index.lock`, `git add` изменённых файлов, `git commit`, `git push origin main`.
2. Проверить: открыть клиентскую ссылку → затраты совпадают с владельцем; «Обновить данные за период» работает.
3. Доработки по желанию: журнал действий в `client_share_accounts`; поведение `/client` с невалидным токеном.
