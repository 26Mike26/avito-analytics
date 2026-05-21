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

create table if not exists public.account_clients (
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, client_user_id)
);
create index if not exists account_clients_user_idx
  on public.account_clients(client_user_id);

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
  source text not null default 'platform'
    check (source in ('platform','avito')),
  title text not null,
  details text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists action_log_user_idx
  on public.action_log(user_id, created_at desc);

create table if not exists public.account_cache (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  balance jsonb,
  account_charges jsonb not null default '[]'::jsonb,
  has_per_item_spend boolean not null default false,
  spendings jsonb,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists account_cache_updated_idx
  on public.account_cache(updated_at desc);

create table if not exists public.item_daily_stats (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  date date not null,
  views integer not null default 0,
  impressions integer not null default 0,
  contacts integer not null default 0,
  favorites integer not null default 0,
  spend numeric not null default 0,
  bid numeric not null default 0,
  accuracy text not null default 'fallback'
    check (accuracy in ('exact','partial','fallback')),
  updated_at timestamptz not null default now(),
  primary key (account_id, item_id, date)
);
create index if not exists item_daily_stats_account_date_idx
  on public.item_daily_stats(account_id, date);
create index if not exists item_daily_stats_accuracy_idx
  on public.item_daily_stats(account_id, accuracy);

create table if not exists public.account_daily_spend (
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  promotion numeric not null default 0,
  presence numeric not null default 0,
  commission numeric not null default 0,
  rest numeric not null default 0,
  ads numeric not null default 0,
  total numeric not null default 0,
  accuracy text not null default 'fallback'
    check (accuracy in ('exact','partial','fallback')),
  updated_at timestamptz not null default now(),
  primary key (account_id, date)
);
create index if not exists account_daily_spend_account_date_idx
  on public.account_daily_spend(account_id, date);

-- ─── Миграция для существующих БД (можно прогонять повторно) ───
-- Если таблица уже создана без поля source, добавим колонку без падения.
alter table public.action_log
  add column if not exists source text not null default 'platform'
  check (source in ('platform','avito'));

-- ──────────────────────── HELPERS ДЛЯ RLS ───────────────────
-- Важно: прямые JOIN-проверки между accounts и account_clients внутри RLS
-- могут дать "infinite recursion detected in policy". SECURITY DEFINER helpers
-- выполняют проверку доступа без зацикливания политик.

create or replace function public.is_account_owner(target_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.accounts a
    where a.id = target_account_id
      and a.owner_id = auth.uid()
  );
$$;

create or replace function public.is_account_client(target_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.account_clients ac
    where ac.account_id = target_account_id
      and ac.client_user_id = auth.uid()
  );
$$;

create or replace function public.can_read_account(target_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_account_owner(target_account_id)
      or public.is_account_client(target_account_id);
$$;

revoke all on function public.is_account_owner(uuid) from public;
revoke all on function public.is_account_client(uuid) from public;
revoke all on function public.can_read_account(uuid) from public;
grant execute on function public.is_account_owner(uuid) to authenticated;
grant execute on function public.is_account_client(uuid) to authenticated;
grant execute on function public.can_read_account(uuid) to authenticated;

-- ─────────────────────────── RLS ─────────────────────────────

alter table public.accounts enable row level security;
alter table public.account_clients enable row level security;
alter table public.items enable row level security;
alter table public.metrics enable row level security;
alter table public.bid_history enable row level security;
alter table public.notes enable row level security;
alter table public.action_log enable row level security;
alter table public.account_cache enable row level security;
alter table public.item_daily_stats enable row level security;
alter table public.account_daily_spend enable row level security;

-- accounts: пользователь видит/изменяет только свои аккаунты
drop policy if exists "accounts owners only" on public.accounts;
create policy "accounts owners only" on public.accounts
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "accounts linked clients read" on public.accounts;
create policy "accounts linked clients read" on public.accounts
  for select
  using (public.is_account_client(accounts.id));

drop policy if exists "account_clients owner manage" on public.account_clients;
create policy "account_clients owner manage" on public.account_clients
  for all
  using (public.is_account_owner(account_clients.account_id))
  with check (public.is_account_owner(account_clients.account_id));

drop policy if exists "account_clients client read" on public.account_clients;
create policy "account_clients client read" on public.account_clients
  for select
  using (client_user_id = auth.uid());

-- items / metrics / bid_history / notes: разрешение через JOIN с accounts
drop policy if exists "items via account" on public.items;
create policy "items via account" on public.items
  for all
  using (public.is_account_owner(items.account_id))
  with check (public.is_account_owner(items.account_id));

drop policy if exists "items linked clients read" on public.items;
create policy "items linked clients read" on public.items
  for select
  using (public.is_account_client(items.account_id));

drop policy if exists "metrics via account" on public.metrics;
create policy "metrics via account" on public.metrics
  for all
  using (public.is_account_owner(metrics.account_id))
  with check (public.is_account_owner(metrics.account_id));

drop policy if exists "metrics linked clients read" on public.metrics;
create policy "metrics linked clients read" on public.metrics
  for select
  using (public.is_account_client(metrics.account_id));

drop policy if exists "bid_history via account" on public.bid_history;
create policy "bid_history via account" on public.bid_history
  for all
  using (public.is_account_owner(bid_history.account_id))
  with check (public.is_account_owner(bid_history.account_id));

drop policy if exists "notes via account" on public.notes;
create policy "notes via account" on public.notes
  for all
  using (public.is_account_owner(notes.account_id))
  with check (public.is_account_owner(notes.account_id));

-- action_log: только свой
drop policy if exists "action_log owner only" on public.action_log;
create policy "action_log owner only" on public.action_log
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "action_log linked clients read" on public.action_log;
create policy "action_log linked clients read" on public.action_log
  for select
  using (
    source = 'avito'
    and account_id is not null
    and public.is_account_client(action_log.account_id)
  );

drop policy if exists "account_cache via account" on public.account_cache;
create policy "account_cache via account" on public.account_cache
  for all
  using (public.is_account_owner(account_cache.account_id))
  with check (public.is_account_owner(account_cache.account_id));

drop policy if exists "account_cache linked clients read" on public.account_cache;
create policy "account_cache linked clients read" on public.account_cache
  for select
  using (public.is_account_client(account_cache.account_id));

drop policy if exists "item_daily_stats via account" on public.item_daily_stats;
create policy "item_daily_stats via account" on public.item_daily_stats
  for all
  using (public.is_account_owner(item_daily_stats.account_id))
  with check (public.is_account_owner(item_daily_stats.account_id));

drop policy if exists "item_daily_stats linked clients read" on public.item_daily_stats;
create policy "item_daily_stats linked clients read" on public.item_daily_stats
  for select
  using (public.is_account_client(item_daily_stats.account_id));

drop policy if exists "account_daily_spend via account" on public.account_daily_spend;
create policy "account_daily_spend via account" on public.account_daily_spend
  for all
  using (public.is_account_owner(account_daily_spend.account_id))
  with check (public.is_account_owner(account_daily_spend.account_id));

drop policy if exists "account_daily_spend linked clients read" on public.account_daily_spend;
create policy "account_daily_spend linked clients read" on public.account_daily_spend
  for select
  using (public.is_account_client(account_daily_spend.account_id));

-- ─────────────────────────── ПОДСКАЗКА ───────────────────────
-- После применения: Supabase → Authentication → Sign Up users в UI.
-- Проверка: select * from public.accounts; — должен вернуть пусто, пока
-- залогиненный через JS клиент пользователь не создаст свой первый аккаунт.
