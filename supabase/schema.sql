-- =============================================================
-- Avito Аналитика — схема Supabase
--
-- Применять в Supabase → SQL Editor → New query → Run.
-- Безопасно прогонять повторно (используются IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- ВАЖНО: пользователи создаются в таблице auth.users (Supabase Auth).
-- Все приложенческие данные привязываются к auth.uid() и защищены через
-- Row Level Security (RLS) — пользователь видит только свои строки.
-- =============================================================

-- ─────────────────────────── ТАБЛИЦЫ ─────────────────────────

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  integration_mode text not null default 'demo'
    check (integration_mode in ('demo','api','csv')),
  integration_user_id text,
  integration_client_id text,
  -- В прототипе секреты хранятся в plain. Для прода используйте pgsodium
  -- (`select pgsodium.crypto_aead_det_encrypt(...)`) и/или серверный прокси,
  -- который никогда не возвращает секреты на клиента.
  integration_client_secret text,
  integration_access_token text,
  last_sync_at timestamptz,
  kpi jsonb not null default '{
    "targetCpl": 350,
    "targetLeads": 800,
    "targetConversionRate": 2.5,
    "monthlyBudget": 250000,
    "weeklyBudget": 60000,
    "dailyBudget": 9000,
    "targetRoi": 120,
    "allowedOverspend": 15,
    "strategy": "balanced"
  }'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists accounts_owner_idx on public.accounts(owner_id);

create table if not exists public.items (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  data jsonb not null,
  primary key (account_id, item_id)
);

create table if not exists public.metrics (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  date date not null,
  data jsonb not null,
  primary key (account_id, item_id, date)
);

create table if not exists public.bid_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  old_bid numeric not null,
  new_bid numeric not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists bid_history_account_idx
  on public.bid_history(account_id, created_at desc);

create table if not exists public.notes (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  text text not null default '',
  updated_at timestamptz not null default now(),
  primary key (account_id, item_id)
);

create table if not exists public.action_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  type text not null,
  title text not null,
  details text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists action_log_user_idx
  on public.action_log(user_id, created_at desc);

-- ─────────────────────────── RLS ─────────────────────────────

alter table public.accounts enable row level security;
alter table public.items enable row level security;
alter table public.metrics enable row level security;
alter table public.bid_history enable row level security;
alter table public.notes enable row level security;
alter table public.action_log enable row level security;

-- accounts: пользователь видит/изменяет только свои аккаунты
drop policy if exists "accounts owners only" on public.accounts;
create policy "accounts owners only" on public.accounts
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- items / metrics / bid_history / notes: разрешение через JOIN с accounts
drop policy if exists "items via account" on public.items;
create policy "items via account" on public.items
  for all
  using (exists (select 1 from public.accounts a
                 where a.id = items.account_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from public.accounts a
                      where a.id = items.account_id and a.owner_id = auth.uid()));

drop policy if exists "metrics via account" on public.metrics;
create policy "metrics via account" on public.metrics
  for all
  using (exists (select 1 from public.accounts a
                 where a.id = metrics.account_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from public.accounts a
                      where a.id = metrics.account_id and a.owner_id = auth.uid()));

drop policy if exists "bid_history via account" on public.bid_history;
create policy "bid_history via account" on public.bid_history
  for all
  using (exists (select 1 from public.accounts a
                 where a.id = bid_history.account_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from public.accounts a
                      where a.id = bid_history.account_id and a.owner_id = auth.uid()));

drop policy if exists "notes via account" on public.notes;
create policy "notes via account" on public.notes
  for all
  using (exists (select 1 from public.accounts a
                 where a.id = notes.account_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from public.accounts a
                      where a.id = notes.account_id and a.owner_id = auth.uid()));

-- action_log: только свой
drop policy if exists "action_log owner only" on public.action_log;
create policy "action_log owner only" on public.action_log
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────── ПОДСКАЗКА ───────────────────────
-- После применения: Supabase → Authentication → Sign Up users в UI.
-- Проверка: select * from public.accounts; — должен вернуть пусто, пока
-- залогиненный через JS клиент пользователь не создаст свой первый аккаунт.
