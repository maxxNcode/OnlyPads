-- ============================================================================
-- ONLYPAD — schema migration 100: the launchpad registry
-- ============================================================================
--
--   WHAT THIS IS
--
--   The registry of coins that ACTUALLY exist on chain. One row per `create_v2`
--   that was signed and confirmed, and it is what the board reads. A launchpad
--   whose "launch" is a database write is not a launchpad, so nothing is written
--   here until the mint comes back from a confirmed transaction.
--
--   ---------------------------------------------------------------------------
--   THE `onlypad_` PREFIX IS NOT DECORATION
--   ---------------------------------------------------------------------------
--
--   This database is SHARED. It already holds 53 tables belonging to other
--   projects, including CLAIM's `claim_*` set. Those must never be read,
--   written, altered or dropped from here.
--
--   Verified immediately before this file was written: no `onlypad` object
--   existed in the schema, so every statement below creates a NEW object. There
--   is no ALTER, DROP or UPDATE against anything this file did not itself
--   create. Idempotent, wrapped in a transaction, safe to run twice.
--
--   ---------------------------------------------------------------------------
--   WHAT ONLYPAD ADDS OVER A PLAIN COIN REGISTRY
--   ---------------------------------------------------------------------------
--
--   Two columns carry the entire product, and neither exists on a normal
--   launchpad:
--
--     verified       false = UNCLAIMED. The coin was created by a fan, the
--                    creator has never proved the handle is theirs, and the Cut
--                    is therefore ACCRUING IN ESCROW rather than being paid. A
--                    reader must never describe an unverified coin as having
--                    paid its creator anything.
--
--     cut_pct        the launcher-set share of the creator fee that goes to the
--                    creator's wallet, 0.40–0.80, frozen at launch. The rest is
--                    Tips (OnlyVault) and the Pad's 5%. Written on chain by
--                    create_v2 and not changeable afterwards, so it is recorded
--                    here rather than recomputed from a constant that could
--                    drift away from what the chain actually says.
--
-- ============================================================================

begin;

-- ============================================================================
-- 1. onlypad_settings — key/value config, editable without a redeploy
-- ============================================================================

create table if not exists public.onlypad_settings (
  key         text primary key,
  value       jsonb,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table public.onlypad_settings is
  'ONLYPAD project: runtime settings. New table, safe to drop.';

-- ============================================================================
-- 2. onlypad_coins — one row per coin actually created on pump.fun
-- ============================================================================

create table if not exists public.onlypad_coins (
  id                uuid primary key default gen_random_uuid(),

  -- `mint` is the identity: what create_v2 produced, and what /coin/<mint> is
  -- keyed on. The unique constraint is what makes a retried submit idempotent
  -- rather than a duplicate listing.
  mint              text        not null unique,
  name              text        not null,
  ticker            text        not null,
  description       text,
  image_url         text,                                 -- IPFS, via Pinata
  metadata_uri      text,                                 -- the URI written on chain
  twitter           text,

  -- Stream / PPV / Lock. Kept from the reference so a stale client cannot write
  -- junk into a NOT NULL column carrying a CHECK constraint.
  mode              text        not null default 'stream',

  -- Who launched it, where the creator fee goes, and whose Cut it is. These are
  -- three different things on purpose: the launcher signs and pays, the fee
  -- wallet collects on every trade forever, and creator_wallet is where the Cut
  -- lands once the creator has proved the handle is theirs.
  launcher_wallet   text        not null,
  fee_wallet        text        not null,
  creator_wallet    text,                                 -- null until verified

  -- The two columns that carry the product. See the header.
  verified          boolean     not null default false,
  cut_pct           numeric(4,3) not null default 0.600,

  -- Proof it happened, so the board is never a claim about the future.
  tx_signature      text,
  dev_buy_sol       numeric(30,9) not null default 0,
  status            text        not null default 'live',

  -- Board display. `is_featured` + `rank_override` are how $ONLYPADS is held at the
  -- top regardless of its market figures: the ordering is
  -- (rank_override nulls last, market_cap_usd desc), so rank_override = 0 sorts
  -- above every unranked row.
  is_featured       boolean     not null default false,
  rank_override     integer,
  liquidity_usd     numeric(30,2) not null default 0,
  volume_24h_usd    numeric(30,2) not null default 0,
  market_cap_usd    numeric(30,2) not null default 0,
  holder_count      integer     not null default 0,
  subs              integer     not null default 0,       -- holders, in OnlyPads's vocabulary
  hue               integer     not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint onlypad_coins_mode_chk   check (mode in ('stream', 'ppv', 'lock')),
  constraint onlypad_coins_status_chk check (status in ('live', 'hidden', 'failed')),
  constraint onlypad_coins_cut_chk    check (cut_pct >= 0.400 and cut_pct <= 0.800),
  constraint onlypad_coins_hue_chk    check (hue >= 0 and hue < 360),
  constraint onlypad_coins_mint_chk   check (char_length(mint) between 32 and 44),
  constraint onlypad_coins_ticker_chk check (char_length(ticker) between 1 and 10),
  constraint onlypad_coins_amounts_chk check (
    liquidity_usd >= 0 and volume_24h_usd >= 0 and market_cap_usd >= 0
    and holder_count >= 0 and subs >= 0 and dev_buy_sol >= 0
  ),
  -- A verified coin must name the wallet the Cut is paid to. Without this a row
  -- could claim VERIFIED and have nowhere to send the money.
  constraint onlypad_coins_verified_chk check (not verified or creator_wallet is not null)
);

comment on table public.onlypad_coins is
  'ONLYPAD project: coins actually launched from this site. New table, safe to drop.';
comment on column public.onlypad_coins.verified is
  'false = UNCLAIMED: the Cut accrues in escrow and has NOT been paid to the creator.';
comment on column public.onlypad_coins.cut_pct is
  'The launcher-set share of the creator fee paid to the creator, 0.40-0.80, frozen on chain at launch.';

-- ============================================================================
-- 3. onlypad_escrow — the Cut ledger, one row per coin
-- ============================================================================
--
-- An UNCLAIMED coin has paid its creator nothing; its Cut sits here instead. The
-- board derives `escrow` from this table, which is why the two can never
-- disagree the way a cached column would.

create table if not exists public.onlypad_escrow (
  id              uuid primary key default gen_random_uuid(),
  mint            text        not null unique
                                references public.onlypad_coins(mint) on delete cascade,
  creator_wallet  text,                                   -- null until verified
  accrued_sol     numeric(30,9) not null default 0,
  claimed_sol     numeric(30,9) not null default 0,
  last_accrued_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint onlypad_escrow_amounts_chk check (accrued_sol >= 0 and claimed_sol >= 0)
);

comment on table public.onlypad_escrow is
  'ONLYPAD project: the Cut accrued against a creator who has not claimed it yet. New table, safe to drop.';

-- ============================================================================
-- 4. onlypad_events — the live activity feed
-- ============================================================================
--
-- Three kinds matter and they are NOT interchangeable:
--   launch  a coin was created. Carries the split, never an amount, because a
--           coin created seconds ago has not paid anyone.
--   cut     the Cut reached a creator. Only ever written for a VERIFIED coin —
--           for an UNCLAIMED one the correct event is `escrow`.
--   escrow  the Cut accrued into escrow. The honest counterpart to `cut`, and
--           the reason a feed row for an unclaimed coin cannot be misread.
--   tips    Tips were claimed out of the OnlyVault.
--   verify  a creator proved the handle and the badge flipped.

create table if not exists public.onlypad_events (
  id          bigserial primary key,
  mint        text,
  kind        text        not null,
  handle      text,
  ticker      text,
  amount      numeric(30,9),
  actor       text,
  payload     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint onlypad_events_kind_chk
    check (kind in ('launch', 'cut', 'escrow', 'tips', 'verify'))
);

comment on table public.onlypad_events is
  'ONLYPAD project: the activity feed. New table, safe to drop.';

-- ============================================================================
-- 5. Indexes — one per real query path, no more
-- ============================================================================

-- the board: featured first, then by size
create index if not exists onlypad_coins_board_idx
  on public.onlypad_coins (rank_override nulls last, market_cap_usd desc);

create index if not exists onlypad_coins_created_idx
  on public.onlypad_coins (created_at desc);

-- a launcher's own coins, the fee wallet's coins, and the unclaimed set that the
-- Creator Escrow panel is built from
create index if not exists onlypad_coins_launcher_idx on public.onlypad_coins (launcher_wallet);
create index if not exists onlypad_coins_fee_wallet_idx on public.onlypad_coins (fee_wallet);
create index if not exists onlypad_coins_unclaimed_idx on public.onlypad_coins (verified)
  where not verified;

-- the feed reads newest-first, always
create index if not exists onlypad_events_recent_idx on public.onlypad_events (created_at desc);
create index if not exists onlypad_events_mint_idx on public.onlypad_events (mint, created_at desc);

-- ============================================================================
-- 6. updated_at trigger — scoped to these tables only
-- ============================================================================

create or replace function public.onlypad_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.onlypad_touch_updated_at() is
  'ONLYPAD project: generic updated_at trigger. New function, safe to drop.';

drop trigger if exists onlypad_coins_touch on public.onlypad_coins;
create trigger onlypad_coins_touch before update on public.onlypad_coins
  for each row execute function public.onlypad_touch_updated_at();

drop trigger if exists onlypad_escrow_touch on public.onlypad_escrow;
create trigger onlypad_escrow_touch before update on public.onlypad_escrow
  for each row execute function public.onlypad_touch_updated_at();

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================
--
-- The anon key may READ the board and may WRITE nothing. Every write goes
-- through the api/* layer with the service role key, which bypasses RLS by
-- design — so a browser holding the publishable key cannot list a coin, cannot
-- flip `verified`, and cannot post an event.

alter table public.onlypad_coins    enable row level security;
alter table public.onlypad_escrow   enable row level security;
alter table public.onlypad_events   enable row level security;
alter table public.onlypad_settings enable row level security;

drop policy if exists onlypad_coins_public_read on public.onlypad_coins;
create policy onlypad_coins_public_read on public.onlypad_coins
  for select to anon, authenticated using (true);

drop policy if exists onlypad_escrow_public_read on public.onlypad_escrow;
create policy onlypad_escrow_public_read on public.onlypad_escrow
  for select to anon, authenticated using (true);

drop policy if exists onlypad_events_public_read on public.onlypad_events;
create policy onlypad_events_public_read on public.onlypad_events
  for select to anon, authenticated using (true);

-- settings stay private: they carry the fee wallet and operational values.
-- No select policy is granted, so only the service role can read them.

-- ============================================================================
-- 8. onlypad_record_coin — record a confirmed launch, idempotently
-- ============================================================================
--
-- Called by POST /api/launch AFTER the transaction is confirmed, with the mint
-- the wallet actually produced. Doing it here rather than as a bare insert is
-- what makes a retry safe: a double submit with the same mint updates the row
-- instead of raising, so the board cannot grow a duplicate listing for one coin.
--
-- It deliberately does NOT accept market figures — those come from the indexer,
-- not from a launcher who would be guessing.
--
-- SECURITY: PostgREST exposes public functions at /rpc/. Without the REVOKE
-- below, anyone holding the anon key could list arbitrary coins on the board.
--
-- TWO PLPGSQL HAZARDS ARE HANDLED HERE, AND BOTH WERE HIT IN THE REFERENCE
-- IMPLEMENTATION BEFORE THEY WERE FIXED:
--
--   1. `#variable_conflict use_column` is REQUIRED, not decorative. The function
--      RETURNS TABLE (… mint text …), and an OUT parameter named `mint` makes
--      the bare `mint` in `ON CONFLICT (mint)` ambiguous — Postgres raises
--      42702, "column reference mint is ambiguous", and refuses the whole call.
--
--   2. `inserted` is worked out by looking the row up first, NOT by testing
--      `xmax = 0` in RETURNING. `xmax` is of type `xid`, so comparing it to an
--      integer is a type error.

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

  /* Does this coin already have a row? That, and only that, is what `inserted`
     reports — a re-submit of a launch that already landed is an update. */
  select c.id, c.created_at into v_id, v_created
    from public.onlypad_coins c where c.mint = p_mint;
  v_inserted := v_id is null;

  insert into public.onlypad_coins as c (
    mint, name, ticker, description, image_url, metadata_uri, twitter,
    mode, cut_pct, launcher_wallet, fee_wallet, tx_signature, dev_buy_sol, status
  ) values (
    p_mint, btrim(p_name), upper(btrim(p_ticker)),
    nullif(btrim(p_description), ''), nullif(btrim(p_image_url), ''),
    nullif(btrim(p_metadata_uri), ''), nullif(btrim(p_twitter), ''),
    p_mode, p_cut_pct, p_launcher_wallet, p_fee_wallet,
    nullif(btrim(p_tx_signature), ''), greatest(coalesce(p_dev_buy_sol, 0), 0), 'live'
  )
  on conflict (mint) do update
     set name         = excluded.name,
         ticker       = excluded.ticker,
         description  = coalesce(excluded.description, c.description),
         image_url    = coalesce(excluded.image_url, c.image_url),
         metadata_uri = coalesce(excluded.metadata_uri, c.metadata_uri),
         twitter      = coalesce(excluded.twitter, c.twitter),
         tx_signature = coalesce(excluded.tx_signature, c.tx_signature);

  if v_inserted then
    select c.id, c.created_at into v_id, v_created
      from public.onlypad_coins c where c.mint = p_mint;
  end if;

  -- Every coin gets an escrow row at birth. It stays at zero for a coin that is
  -- created already-verified, and fills for a Fan Launch — but the row existing
  -- means the board never has to distinguish "no escrow" from "no row".
  insert into public.onlypad_escrow (mint) values (p_mint)
  on conflict (mint) do nothing;

  -- The launch event. Carries the split, not an amount: a coin created seconds
  -- ago has not paid anyone, and the feed must not imply it has.
  insert into public.onlypad_events (mint, kind, ticker, handle, payload)
  values (
    p_mint, 'launch', upper(btrim(p_ticker)), null,
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

comment on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, numeric) is
  'ONLYPAD project: records a confirmed launch idempotently. Service-role only.';

revoke all on function public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, numeric)
  from public, anon, authenticated;

-- ============================================================================
-- 9. onlypad_record_event — the feed writer, service-role only
-- ============================================================================
--
-- `cut` is refused for an unverified coin, in the database rather than only in
-- the caller. This project shipped a feed that said "Cut paid to @northstar" for
-- a creator who had never been paid, and the rule that forbids it belongs where
-- it cannot be forgotten.

create or replace function public.onlypad_record_event(
  p_mint   text,
  p_kind   text,
  p_handle text,
  p_ticker text,
  p_amount numeric,
  p_actor  text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_verified boolean;
begin
  if p_kind not in ('launch', 'cut', 'escrow', 'tips', 'verify') then
    raise exception 'onlypad_record_event: unknown kind %', p_kind using errcode = '22023';
  end if;

  if p_kind = 'cut' then
    select c.verified into v_verified from public.onlypad_coins c where c.mint = p_mint;
    if v_verified is not true then
      raise exception
        'onlypad_record_event: refusing a "cut" event for an unclaimed coin (%) — the Cut is in escrow and has not been paid. Record "escrow" instead.',
        p_mint
        using errcode = '22023';
    end if;
  end if;

  insert into public.onlypad_events (mint, kind, handle, ticker, amount, actor, payload)
  values (p_mint, p_kind, p_handle, p_ticker, p_amount, p_actor, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.onlypad_record_event(text, text, text, text, numeric, text, jsonb) is
  'ONLYPAD project: writes a feed event, refusing "cut" for an unclaimed coin. Service-role only.';

revoke all on function public.onlypad_record_event(text, text, text, text, numeric, text, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- 10. Seed settings
-- ============================================================================

insert into public.onlypad_settings (key, value, description) values
  ('cut_default',   '0.60'::jsonb,  'Default Cut, as a fraction. Launcher may set 0.40-0.80; frozen on chain at launch.'),
  ('cut_min',       '0.40'::jsonb,  'Minimum Cut a launcher may set.'),
  ('cut_max',       '0.80'::jsonb,  'Maximum Cut a launcher may set.'),
  ('pad_share',     '0.125'::jsonb, 'The Pad''s share of whatever is left after the Cut. 0.05/(1-0.60) = 0.125.'),
  ('drop_seconds',  '900'::jsonb,   'Length of one Drop. Must match the on-chain crank or the countdown disagrees with the pot.'),
  ('max_stack',     '12'::jsonb,    'How many unclaimed Drops stack before the oldest stops accruing.'),
  ('min_hold',      '100'::jsonb,   'Holders under this many $ONLYPADS are removed from the weight set entirely, not given a zero share.'),
  ('burn_split',    '0.5'::jsonb,   'Half of every buyback burns, half fills the Tip Jar.'),
  ('fee_wallet',    'null'::jsonb,  'The wallet every launched coin routes its pump.fun creator fee to. Written on chain at launch and not changeable afterwards.'),
  ('featured_mint', 'null'::jsonb,  'The mint pinned to rank 1 on the board. Null until $ONLYPADS is deployed.')
on conflict (key) do nothing;

-- ============================================================================
-- 11. Verify — fail the whole transaction if anything is missing
-- ============================================================================

do $$
declare
  missing text;
begin
  select string_agg(want, ', ') into missing
  from (values ('onlypad_settings'), ('onlypad_coins'), ('onlypad_escrow'), ('onlypad_events')) as t(want)
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t.want
  );

  if missing is not null then
    raise exception 'ONLYPAD migration 100 incomplete — missing tables: %', missing;
  end if;

  select string_agg(want, ', ') into missing
  from (values ('onlypad_record_coin'), ('onlypad_record_event'), ('onlypad_touch_updated_at')) as t(want)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = t.want
  );

  if missing is not null then
    raise exception 'ONLYPAD migration 100 incomplete — missing functions: %', missing;
  end if;

  raise notice 'ONLYPAD migration 100 OK — 4 tables, 3 functions, RLS on.';
end $$;

commit;

-- ============================================================================
-- TEARDOWN — scoped to onlypad_* only; cannot affect the other 53 tables.
-- ============================================================================
--
-- begin;
--   drop function if exists public.onlypad_record_event(text, text, text, text, numeric, text, jsonb) cascade;
--   drop function if exists public.onlypad_record_coin(text, text, text, text, text, text, text, text, numeric, text, text, text, numeric) cascade;
--   drop table if exists public.onlypad_events cascade;
--   drop table if exists public.onlypad_escrow cascade;
--   drop table if exists public.onlypad_coins cascade;
--   drop table if exists public.onlypad_settings cascade;
--   drop function if exists public.onlypad_touch_updated_at() cascade;
-- commit;
--
-- ============================================================================
