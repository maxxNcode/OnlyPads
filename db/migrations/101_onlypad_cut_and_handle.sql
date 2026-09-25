-- ============================================================================
-- ONLYPADS — schema migration 101: the creator handle, and the Cut on the wire
-- ============================================================================
--
--   WHY
--
--   The launch wizard collects a creator handle — the @name this coin pays — and
--   a Cut the launcher chose on a slider. Neither reached the database:
--   `onlypad_record_coin` had no parameter for them, so every coin silently got
--   the 0.60 default and the handle was thrown away. A slider that does nothing
--   is worse than no slider.
--
--   Purely additive: one ADD COLUMN and a CREATE OR REPLACE. No DROP, no ALTER
--   of anything this project did not create, nothing touched outside `onlypad_`.
--
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. creator_handle — the @name the coin pays
-- ---------------------------------------------------------------------------
--
-- Nullable on purpose. A coin can exist without one (the wizard may not have it,
-- and an older client will not send it), and a NOT NULL column would reject
-- every launch from that client.

alter table public.onlypad_coins
  add column if not exists creator_handle text;

comment on column public.onlypad_coins.creator_handle is
  'ONLYPADS: the @handle this coin pays. Null means the launcher did not give one.';

-- The escrow panel groups by handle once a creator verifies, so it is worth an
-- index; partial, because most rows will have one and only the lookup matters.
create index if not exists onlypad_coins_handle_idx
  on public.onlypad_coins (lower(creator_handle))
  where creator_handle is not null;

-- ---------------------------------------------------------------------------
-- 2. onlypad_record_coin — now carries the Cut and the handle
-- ---------------------------------------------------------------------------
--
-- The old 13-argument version is DROPPED and replaced rather than overloaded.
-- Postgres would keep both and resolve by arity, which means a stale client
-- calling with 13 arguments would still succeed and still write cut_pct = 0.60 —
-- exactly the silent-default bug this migration exists to fix.

drop function if exists public.onlypad_record_coin(
  text, text, text, text, text, text, text, text, numeric, text, text, text, numeric
);

create or replace function public.onlypad_record_coin(
  p_mint            text,
  p_name            text,
  p_ticker          text,
  p_description     text,
  p_image_url       text,
  p_metadata_uri    text,
  p_twitter         text,
  p_mode            text,
  p_cut_pct         numeric,
  p_creator_handle  text,
  p_launcher_wallet text,
  p_fee_wallet      text,
  p_tx_signature    text,
  p_dev_buy_sol     numeric
)
returns table (id uuid, mint text, name text, ticker text, created_at timestamptz, inserted boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id       uuid;
  v_created  timestamptz;
  v_inserted boolean;
  v_handle   text;
begin
  if p_mint is null or char_length(p_mint) < 32 or char_length(p_mint) > 44 then
    raise exception 'onlypad_record_coin: mint must be a base58 address'
      using errcode = '22023';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'onlypad_record_coin: name is required'
      using errcode = '22023';
  end if;
  if p_launcher_wallet is null or p_fee_wallet is null then
    raise exception 'onlypad_record_coin: launcher and fee wallet are required'
      using errcode = '22023';
  end if;
  if p_mode not in ('stream', 'ppv', 'lock') then
    raise exception 'onlypad_record_coin: unknown mode %', p_mode
      using errcode = '22023';
  end if;
  -- The Cut is launcher-set between 40% and 80% and frozen on chain. A value
  -- outside that range means the client and the contract disagree, which is
  -- worth refusing rather than storing.
  if p_cut_pct is null or p_cut_pct < 0.400 or p_cut_pct > 0.800 then
    raise exception 'onlypad_record_coin: cut_pct must be between 0.40 and 0.80, got %', p_cut_pct
      using errcode = '22023';
  end if;

  -- Normalise the handle: strip a leading @, trim, lowercase, and treat blank as
  -- absent so the column stays NULL rather than empty-string.
  v_handle := nullif(lower(btrim(replace(coalesce(p_creator_handle, ''), '@', ''))), '');

  select c.id, c.created_at into v_id, v_created
    from public.onlypad_coins c where c.mint = p_mint;
  v_inserted := v_id is null;

  insert into public.onlypad_coins as c (
    mint, name, ticker, description, image_url, metadata_uri, twitter,
    mode, cut_pct, creator_handle, launcher_wallet, fee_wallet,
    tx_signature, dev_buy_sol, status
  ) values (
    p_mint, btrim(p_name), upper(btrim(p_ticker)),
    nullif(btrim(p_description), ''), nullif(btrim(p_image_url), ''),
    nullif(btrim(p_metadata_uri), ''), nullif(btrim(p_twitter), ''),
    p_mode, p_cut_pct, v_handle, p_launcher_wallet, p_fee_wallet,
    nullif(btrim(p_tx_signature), ''), greatest(coalesce(p_dev_buy_sol, 0), 0), 'live'
  )
  on conflict (mint) do update
     set name           = excluded.name,
         ticker         = excluded.ticker,
         description    = coalesce(excluded.description, c.description),
         image_url      = coalesce(excluded.image_url, c.image_url),
         metadata_uri   = coalesce(excluded.metadata_uri, c.metadata_uri),
         twitter        = coalesce(excluded.twitter, c.twitter),
         -- the Cut is frozen on chain, so a re-submit must NOT be able to move it
         cut_pct        = c.cut_pct,
         creator_handle = coalesce(excluded.creator_handle, c.creator_handle),
         tx_signature   = coalesce(excluded.tx_signature, c.tx_signature);

  if v_inserted then
    select c.id, c.created_at into v_id, v_created
      from public.onlypad_coins c where c.mint = p_mint;
  end if;

  insert into public.onlypad_escrow (mint) values (p_mint)
  on conflict (mint) do nothing;

  -- The launch event carries the split, not an amount: a coin created seconds
  -- ago has not paid anyone, and the feed must not imply it has.
  insert into public.onlypad_events (mint, kind, ticker, handle, payload)
  values (
    p_mint, 'launch', upper(btrim(p_ticker)), v_handle,
    jsonb_build_object(
      'mode', p_mode,
      'cutPct', p_cut_pct,
      'split', jsonb_build_object(
        'cut',  round(p_cut_pct * 100),
        'tips', round((1 - p_cut_pct) * (1 - 0.125) * 100),
        'pad',  round((1 - p_cut_pct) * 0.125 * 100)
      )
    )
  );

  return query select v_id, p_mint, btrim(p_name), upper(btrim(p_ticker)), v_created, v_inserted;
end;
$$;

comment on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric) is
  'ONLYPADS: records a confirmed launch idempotently, carrying the launcher-set Cut and the creator handle. Service-role only.';

revoke all on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'onlypad_coins' and column_name = 'creator_handle'
  ) then
    raise exception 'ONLYPADS migration 101 incomplete — onlypad_coins.creator_handle missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'onlypad_record_coin' and p.pronargs = 14
  ) then
    raise exception 'ONLYPADS migration 101 incomplete — the 14-argument onlypad_record_coin is missing';
  end if;

  -- the 13-argument version must be gone, or a stale client keeps the old default
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'onlypad_record_coin' and p.pronargs = 13
  ) then
    raise exception 'ONLYPADS migration 101 incomplete — the old 13-argument onlypad_record_coin still exists';
  end if;

  raise notice 'ONLYPADS migration 101 OK — creator_handle present, record function carries the Cut.';
end $$;

commit;

-- ============================================================================
-- TEARDOWN — scoped to onlypad_* only.
-- ============================================================================
-- begin;
--   drop function if exists public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric) cascade;
--   drop index if exists public.onlypad_coins_handle_idx;
--   alter table public.onlypad_coins drop column if exists creator_handle;
-- commit;
-- ============================================================================
