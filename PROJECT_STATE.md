# PROJECT_STATE.md

## Current objective
Раздел «Клиенты»: выдача клиентам доступа по токен-ссылке к ограниченному кабинету `/client`. Этапы 1–2 выполнены, миграция Supabase применена (проверено: таблица client_shares, RPC resolve_client_share/client_share_accounts, RLS-политика — все на месте). Осталось: протестировать вход по ссылке вживую.

## Changed files
Codex (HEAD~12..HEAD): Dashboard.tsx, Analytics.tsx, Compare.tsx, Header.tsx, Sidebar.tsx, AccountSwitcher.tsx, Layout.tsx, PeriodPicker.tsx, ActionLog.tsx, Items.tsx, Settings.tsx, Recommendations.tsx, KpiCenter.tsx, ItemDetail.tsx, Bids.tsx, Insights.tsx, Accounts.tsx, Login.tsx, Signup.tsx; новый src/lib/download.ts.

## Completed changes
- Раздел «Клиенты» (этап 1): тип `ClientShare`/`ClientShareStatus` в types/index.ts; `services/ClientShareService.ts`; компонент `components/ClientsPanel.tsx`; вкладка «Аккаунты | Клиенты» в Accounts.tsx. Доступ по ссылке `/client?ct=<token>`, права фиксированные.
- Раздел «Клиенты» (этап 2): новый `supabase/client_shares.sql` (таблица + RLS владельца + SECURITY DEFINER RPC `resolve_client_share` и `client_share_accounts`, секреты интеграции вычищены, grant anon). `ClientShareService` переведён на async + dual-mode (Supabase ↔ localStorage-fallback) + хелперы токена. `ClientsPanel` адаптирован под async. `useStore.bootstrap()` резолвит токен `ct` (URL/localStorage) и собирает синтетическую клиентскую сессию; `logout` чистит токен. Маршрут `/c/:token` в App.tsx.
- #9: эффективность по категориям группируется по подкатегории (subcategoryName) в recommendations.ts (categoryWinners, computeCategoryStats, calculateBidRecommendation) и ItemDetail.tsx (исправлен баг лукапа categoryAverages по сырой category).
- Precise-статистика: чтение Supabase → localStorage-кэш (scoped by period) в Dashboard/Analytics/Compare. Store по-прежнему пишет в Supabase.
- Mobile-адаптация: sidebar, header, account switcher, compare-кнопки, responsive-гриды.
- Header search подключён к Объявлениям. Confirm logout. Единая утилита download.ts.
- Ранее (до Codex): /stats/v2/spendings, точный расчёт городов/топ-10 по filter.itemIDs, CTR=views/impressions, светлая тема, реактивные графики.
- tsc --noEmit чистый, backend node --check OK.

## Current risks
- Миграция `client_shares.sql` применена в Supabase (проект cftkimfzohbnkwdvupsh). Сквозной вход клиента по ссылке вживую ещё не протестирован.
- tsc и `vite build` — чисто, 2469 модулей.
- ClientActionLog для токен-клиента пока пустой: RPC `client_share_accounts` не возвращает журнал действий (только items/metrics/cache).
- Precise-данные не синхронизируются между устройствами: store пишет в Supabase, страницы читают только localStorage.
- localStorage-кэш растёт без TTL (ключи по периодам).

## Next action
1. Закоммитить и запушить изменения вручную с Mac (песочница не может писать в `.git`): `rm -f .git/index.lock`, затем `git add ...` нужных файлов, `git commit`, `git push origin main` → Vercel задеплоит.
2. Протестировать: создать доступ на вкладке «Клиенты» → открыть ссылку `/client?ct=...` в приватном окне → проверить кабинет и отзыв.
3. При необходимости — отдавать журнал действий в RPC `client_share_accounts` (сейчас ClientActionLog у токен-клиента пустой).
