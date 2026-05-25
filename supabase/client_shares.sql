-- =============================================================
-- Avito Аналитика — раздел «Клиенты»: доступ по токен-ссылке
--
-- Применять в Supabase → SQL Editor → New query → Run.
-- Безопасно прогонять повторно (IF NOT EXISTS / DROP ... IF EXISTS / OR REPLACE).
--
-- Модель: владелец создаёт «доступ» (client_shares) и передаёт клиенту
-- ссылку с токеном. Клиент открывает /client?ct=<token> без логина и
-- получает доступ в режиме просмотра к выбранным аккаунтам.
--
-- Безопасность: анонимный посетитель НЕ имеет прямого доступа к таблицам.
-- Данные он получает только через SECURITY DEFINER функции, которые
-- проверяют токен. Секреты интеграции (client_secret, access_token и т.п.)
-- в выдачу клиенту НЕ попадают.
-- =============================================================

-- ─────────────────────────── ТАБЛИЦА ─────────────────────────

create table if not exists public.client_shares (
  id uuid primary key default gen_random_uuid(),
  -- Секретный токен из ссылки. Длинный и случайный, генерируется на клиенте.
  token text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  -- Аккаунты владельца, видимые по этому доступу.
  account_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Срок действия (null — бессрочно) и отметка отзыва (null — активен).
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists client_shares_owner_idx
  on public.client_shares(owner_id);
create index if not exists client_shares_token_idx
  on public.client_shares(token);

-- ─────────────────────────── RLS ─────────────────────────────
-- Владелец управляет только своими доступами. Анонимной политики нет:
-- анон ходит исключительно через функции resolve_client_share /
-- client_share_accounts ниже.

alter table public.client_shares enable row level security;

drop policy if exists "client_shares owner manage" on public.client_shares;
create policy "client_shares owner manage" on public.client_shares
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ─────────────────── ФУНКЦИЯ: РЕЗОЛВ ТОКЕНА ──────────────────
-- Возвращает метаданные доступа по токену, если он активен (не отозван,
-- не истёк). Иначе — null. Доступна анониму.

create or replace function public.resolve_client_share(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'id', cs.id,
    'token', cs.token,
    'ownerUserId', cs.owner_id,
    'label', cs.label,
    'accountIds', cs.account_ids,
    'createdAt', cs.created_at,
    'expiresAt', cs.expires_at,
    'revokedAt', cs.revoked_at
  )
  from public.client_shares cs
  where cs.token = p_token
    and cs.revoked_at is null
    and (cs.expires_at is null or cs.expires_at > now());
$$;

-- ──────────────── ФУНКЦИЯ: ДАННЫЕ АККАУНТОВ ──────────────────
-- Возвращает данные аккаунтов, привязанных к доступу, в форме, готовой
-- к загрузке в стор клиента (camelCase). Секреты интеграции вычищены.

create or replace function public.client_share_accounts(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_share public.client_shares;
  v_result jsonb;
begin
  select * into v_share
  from public.client_shares cs
  where cs.token = p_token
    and cs.revoked_at is null
    and (cs.expires_at is null or cs.expires_at > now());

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(acc.payload), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', a.id,
      'ownerId', a.owner_id,
      'name', a.name,
      'createdAt', a.created_at,
      'kpi', a.kpi,
      'integration', jsonb_build_object(
        'mode', a.integration_mode,
        'userId', '',
        'clientId', '',
        'clientSecret', '',
        'accessToken', '',
        'lastSyncAt', a.last_sync_at
      ),
      'items', coalesce(
        (select jsonb_agg(i.data) from public.items i where i.account_id = a.id),
        '[]'::jsonb
      ),
      'metrics', coalesce(
        (select jsonb_agg(m.data) from public.metrics m where m.account_id = a.id),
        '[]'::jsonb
      ),
      'bidHistory', '[]'::jsonb,
      'notes', '{}'::jsonb,
      'recommendations', '[]'::jsonb,
      'balance', c.balance,
      'accountCharges', coalesce(c.account_charges, '[]'::jsonb),
      'hasPerItemSpend', coalesce(c.has_per_item_spend, false),
      'spendings', c.spendings,
      'periodCache', coalesce(c.meta -> 'periodCache', '{}'::jsonb)
    ) as payload
    from public.accounts a
    left join public.account_cache c on c.account_id = a.id
    where a.id = any (v_share.account_ids)
  ) acc;

  return v_result;
end;
$$;

-- Доступ к функциям: только через них анон получает данные.
revoke all on function public.resolve_client_share(text) from public;
revoke all on function public.client_share_accounts(text) from public;
grant execute on function public.resolve_client_share(text) to anon, authenticated;
grant execute on function public.client_share_accounts(text) to anon, authenticated;

-- ─────────────────────────── ПОДСКАЗКА ───────────────────────
-- Проверка резолва:  select public.resolve_client_share('<token>');
-- Проверка данных:   select public.client_share_accounts('<token>');
