-- ============================================================================
-- ONLYPADS — schema migration 102: creator_verified
-- ============================================================================
--
--   WHY
--
--   `/api/launch` fails CLOSED when the pump.fun index is unreachable, which is
--   correct for a definitive "that coin belongs to someone else" and wrong for a
--   throttled index. MEASURED: the index answers HTTP 429 under load, and it
--   answers 429 to datacenter egress outright — so on a deployed site a busy
--   index blocks EVERY legitimate launch from being recorded. The coin exists on
--   chain and the user has paid for it; refusing to list it is the worst outcome.
--
--   This column separates the two cases:
--
--     creator_verified = true   the index confirmed the creator is our fee wallet
--     creator_verified = false  the index could not be reached, so the coin is
--                               listed but FLAGGED as unconfirmed
--
--   A definitive mismatch still rejects — that is a real negative, not an outage,
--   and listing someone else's coin is what this check exists to prevent.
--
--   Purely additive: one ADD COLUMN and a CREATE OR REPLACE. Nothing outside
--   `onlypad_` is touched.
--
-- ============================================================================

begin;

alter table public.onlypad_coins
  add column if not exists creator_verified boolean not null default false;

comment on column public.onlypad_coins.creator_verified is
  'ONLYPADS: true only when the pump.fun index confirmed the creator is our fee wallet. False means unconfirmed (the index was unreachable), NOT that it is wrong.';

-- The board needs to surface these, so they are worth a partial index.
create index if not exists onlypad_coins_unconfirmed_idx
  on public.onlypad_coins (created_at desc)
  where not creator_verified;

-- ---------------------------------------------------------------------------
-- onlypad_record_coin — 15 arguments, carrying the verification outcome
-- ---------------------------------------------------------------------------
--
-- The 14-argument version is DROPPED, not overloaded. Postgres resolves by arity,
-- so keeping both would let a stale client succeed while silently writing
-- creator_verified = false for a coin that was actually confirmed.

drop function if exists public.onlypad_record_coin(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric
);

create or replace function public.onlypad_record_coin(
  p_mint             text,
  p_name             text,
  p_ticker           text,
  p_description      text,
  p_image_url        text,
  p_metadata_uri     text,
  p_twitter          text,
  p_mode             text,
  p_cut_pct          numeric,
  p_creator_handle   text,
  p_launcher_wallet  text,
  p_fee_wallet       text,
  p_tx_signature     text,
  p_dev_buy_sol      numeric,
  p_creator_verified boolean
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
  if p_cut_pct is null or p_cut_pct < 0.400 or p_cut_pct > 0.800 then
    raise exception 'onlypad_record_coin: cut_pct must be between 0.40 and 0.80, got %', p_cut_pct
      using errcode = '22023';
  end if;

  v_handle := nullif(lower(btrim(replace(coalesce(p_creator_handle, ''), '@', ''))), '');

  select c.id, c.created_at into v_id, v_created
    from public.onlypad_coins c where c.mint = p_mint;
  v_inserted := v_id is null;

  insert into public.onlypad_coins as c (
    mint, name, ticker, description, image_url, metadata_uri, twitter,
    mode, cut_pct, creator_handle, launcher_wallet, fee_wallet,
    tx_signature, dev_buy_sol, status, creator_verified
  ) values (
    p_mint, btrim(p_name), upper(btrim(p_ticker)),
    nullif(btrim(p_description), ''), nullif(btrim(p_image_url), ''),
    nullif(btrim(p_metadata_uri), ''), nullif(btrim(p_twitter), ''),
    p_mode, p_cut_pct, v_handle, p_launcher_wallet, p_fee_wallet,
    nullif(btrim(p_tx_signature), ''), greatest(coalesce(p_dev_buy_sol, 0), 0), 'live',
    coalesce(p_creator_verified, false)
  )
  on conflict (mint) do update
     set name             = excluded.name,
         ticker           = excluded.ticker,
         description      = coalesce(excluded.description, c.description),
         image_url        = coalesce(excluded.image_url, c.image_url),
         metadata_uri     = coalesce(excluded.metadata_uri, c.metadata_uri),
         twitter          = coalesce(excluded.twitter, c.twitter),
         -- the Cut is frozen on chain, so a re-submit must NOT be able to move it
         cut_pct          = c.cut_pct,
         creator_handle   = coalesce(excluded.creator_handle, c.creator_handle),
         tx_signature     = coalesce(excluded.tx_signature, c.tx_signature),
         -- one-way: a later confirmed read must be able to clear the flag, but a
         -- later outage must never be able to set it back
         creator_verified = c.creator_verified or excluded.creator_verified;

  if v_inserted then
    select c.id, c.created_at into v_id, v_created
      from public.onlypad_coins c where c.mint = p_mint;
  end if;

  insert into public.onlypad_escrow (mint) values (p_mint)
  on conflict (mint) do nothing;

  insert into public.onlypad_events (mint, kind, ticker, handle, payload)
  values (
    p_mint, 'launch', upper(btrim(p_ticker)), v_handle,
    jsonb_build_object(
      'mode', p_mode,
      'cutPct', p_cut_pct,
      'creatorVerified', coalesce(p_creator_verified, false),
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

comment on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric, boolean) is
  'ONLYPADS: records a confirmed launch. creator_verified=false means the index was unreachable, not that the creator is wrong. Service-role only.';

revoke all on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'onlypad_coins' and column_name = 'creator_verified'
  ) then
    raise exception 'ONLYPADS migration 102 incomplete — creator_verified missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'onlypad_record_coin' and p.pronargs = 15
  ) then
    raise exception 'ONLYPADS migration 102 incomplete — the 15-argument record function is missing';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'onlypad_record_coin' and p.pronargs = 14
  ) then
    raise exception 'ONLYPADS migration 102 incomplete — the old 14-argument record function still exists';
  end if;

  raise notice 'ONLYPADS migration 102 OK — creator_verified present, 15-argument record function only.';
end $$;

commit;

-- ============================================================================
-- TEARDOWN
-- ============================================================================
-- begin;
--   drop function if exists public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, text, numeric, boolean) cascade;
--   drop index if exists public.onlypad_coins_unconfirmed_idx;
--   alter table public.onlypad_coins drop column if exists creator_verified;
-- commit;
-- ============================================================================
