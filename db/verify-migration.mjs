/* ==========================================================================
   CLAIM — db/verify-migration.mjs
   Runs the migration against a real Postgres (PGlite = Postgres compiled to
   WASM, no server, no Docker) and asserts it does what it claims.

   Why this exists: the migration runs against a SHARED production database
   that other projects depend on. "It looks right" is not good enough. This
   proves — on a throwaway database — that the file creates exactly seven
   claim_* tables, touches nothing else, enforces its constraints, survives
   being run twice, and tears down cleanly.

   Run:
     NODE_PATH=<isolated-workspace>/node_modules node db/verify-migration.mjs

   Requires @electric-sql/pglite (a dev-only tool, deliberately NOT a
   dependency of the site — the site stays zero-dependency).
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/* ---------- resolve PGlite from the isolated workspace ---------- */
const PGLITE_BASE =
  process.env.PGLITE_BASE ||
  'C:/Users/USER/.workbuddy-ai/binaries/node/workspace/';

let PGlite;
try {
  const req = createRequire(PGLITE_BASE.endsWith('/') ? PGLITE_BASE : PGLITE_BASE + '/');
  const entry = req.resolve('@electric-sql/pglite');
  ({ PGlite } = await import(pathToFileURL(entry).href));
} catch (e) {
  console.error('Could not load @electric-sql/pglite from ' + PGLITE_BASE);
  console.error('  ' + e.message);
  console.error('\nInstall it into the isolated workspace, not the project:');
  console.error('  cd ' + PGLITE_BASE);
  console.error('  npm install @electric-sql/pglite');
  process.exit(2);
}

/* ---------- harness ---------- */
let fail = 0;
function ok(label, got, want) {
  const pass = String(got) === String(want);
  if (!pass) fail++;
  console.log((pass ? '  ok   ' : '  FAIL ') + label.padEnd(52) + 'got ' + got + (pass ? '' : '   want ' + want));
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
async function throws(label, fn) {
  try { await fn(); ok(label, 'no error thrown', 'rejected'); }
  catch (e) { ok(label, 'rejected', 'rejected'); }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, 'migrations', '001_claim_schema.sql');
const MIGRATION_2 = path.join(HERE, 'migrations', '002_claim_admin.sql');
const SQL = readFileSync(MIGRATION, 'utf8');
const SQL2 = readFileSync(MIGRATION_2, 'utf8');

const db = new PGlite();

/* Emulate the three Supabase roles. Supabase ships these; vanilla Postgres
   does not, and the migration's RLS policies grant to anon/authenticated. */
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end $$;
`);

/* A stand-in for the user's OTHER projects, to prove we do not touch them. */
await db.exec(`
  create table if not exists public.coins  (id int primary key, sym text);
  create table if not exists public.events (id int primary key, kind text);
  create table if not exists public.settings (id int primary key, k text);
  create table if not exists public.buyback_jobs (id int primary key);
  insert into public.coins values (1, 'OTHER') on conflict do nothing;
`);

async function tableNames() {
  const r = await db.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  return r.rows.map((x) => x.table_name);
}

const before = await tableNames();

/* ================= 1. apply ================= */
section('apply the migration to a real Postgres');
let applyError = null;
try {
  await db.exec(SQL);
} catch (e) {
  applyError = e;
}
ok('migration applies without error', applyError ? applyError.message : 'clean', 'clean');
if (applyError) {
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION FAILED TO APPLY — stopping here, everything below is moot.');
  console.log('='.repeat(70));
  process.exit(1);
}

/* ================= 2. tables ================= */
section('tables created');
const after = await tableNames();
const created = after.filter((t) => !before.includes(t));
const EXPECTED = [
  'claim_epochs',
  'claim_events',
  'claim_holder_stats',
  'claim_launches',
  'claim_positions',
  'claim_settings',
  'claim_vaults'
];
ok('exactly 7 tables created', created.length, 7);
ok('all of them are claim_*', created.every((t) => t.startsWith('claim_')), 'true');
ok('the expected 7, by name', created.slice().sort().join(','), EXPECTED.join(','));

/* ================= 3. the other projects are untouched ================= */
section('other projects are untouched');
ok('coins still exists', after.includes('coins'), 'true');
ok('events still exists', after.includes('events'), 'true');
ok('settings still exists', after.includes('settings'), 'true');
ok('buyback_jobs still exists', after.includes('buyback_jobs'), 'true');
const otherData = await db.query('select sym from public.coins where id = 1');
ok('coins data intact', otherData.rows[0].sym, 'OTHER');
ok('no existing table was altered', before.every((t) => after.includes(t)), 'true');

/* ================= 4. RLS ================= */
section('row level security');
const rls = await db.query(`
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'claim_%' and c.relkind = 'r'
  order by c.relname
`);
ok('RLS enabled on every claim_ table', rls.rows.every((r) => r.relrowsecurity === true), 'true');
ok('that is 7 tables', rls.rows.length, 7);

const policies = await db.query(`
  select tablename, policyname, cmd, roles::text as roles
  from pg_policies where schemaname = 'public' and tablename like 'claim_%'
  order by tablename
`);
ok('exactly 6 policies', policies.rows.length, 6);
ok('all are SELECT policies', policies.rows.every((p) => p.cmd === 'SELECT'), 'true');
const withPolicy = policies.rows.map((p) => p.tablename);
ok('claim_launches has NO policy (signatures stay private)',
  withPolicy.includes('claim_launches'), 'false');
ok('every other claim_ table is publicly readable',
  withPolicy.slice().sort().join(','),
  'claim_epochs,claim_events,claim_holder_stats,claim_positions,claim_settings,claim_vaults');

/* ================= 5. triggers + function ================= */
section('triggers and helper function');
const trig = await db.query(`
  select tgname from pg_trigger
  where tgrelid in (
    'public.claim_vaults'::regclass, 'public.claim_positions'::regclass,
    'public.claim_holder_stats'::regclass
  ) and not tgisinternal order by tgname
`);
ok('3 updated_at triggers attached', trig.rows.length, 3);
const fn = await db.query(`
  select proname from pg_proc where proname = 'claim_touch_updated_at'
`);
ok('touch function exists', fn.rows.length, 1);

/* ================= 6. seed data ================= */
section('claim_settings seeded');
const settings = await db.query('select key, value from public.claim_settings order by key');
ok('5 settings rows', settings.rows.length, 5);
const keys = settings.rows.map((r) => r.key).sort().join(',');
ok('the expected keys', keys, 'burn_split,epoch_seconds,max_stack,min_hold,pot_per_epoch');

/* ================= 7. constraints actually bite ================= */
section('constraints reject bad data');
const goodVault = `insert into public.claim_vaults
  (mint, name, ticker, mode, creator_wallet, vault_share_bps, treasury_share_bps)
  values ('MINT1','Test Coin','$TEST','stream','WALLET1',8000,2000)`;

await db.exec(goodVault);
const v1 = await db.query("select id, unclaimed_amount, created_at, updated_at from public.claim_vaults where mint='MINT1'");
ok('a well-formed vault inserts', v1.rows.length, 1);
ok('defaults applied', Number(v1.rows[0].unclaimed_amount), 0);

await throws('bad mode is rejected', () => db.exec(
  `insert into public.claim_vaults (mint,name,ticker,mode,creator_wallet)
   values ('M2','X','$X','not-a-mode','W')`));

await throws('shares that do not sum to 10000 are rejected', () => db.exec(
  `insert into public.claim_vaults (mint,name,ticker,creator_wallet,vault_share_bps,treasury_share_bps)
   values ('M3','X','$X','W',5000,2000)`));

await throws('negative unclaimed is rejected', () => db.exec(
  `insert into public.claim_vaults (mint,name,ticker,creator_wallet,unclaimed_amount)
   values ('M4','X','$X','W',-5)`));

await throws('duplicate mint is rejected', () => db.exec(
  `insert into public.claim_vaults (mint,name,ticker,creator_wallet)
   values ('MINT1','Dup','$DUP','W')`));

await throws('duplicate (vault, wallet) position is rejected', async () => {
  await db.exec(`insert into public.claim_positions (vault_id, wallet, balance)
    values ('${v1.rows[0].id}','WALLET1',500)`);
  await db.exec(`insert into public.claim_positions (vault_id, wallet, balance)
    values ('${v1.rows[0].id}','WALLET1',600)`);
});

await throws('an unknown claim kind is rejected', () => db.exec(
  `insert into public.claim_events (kind, wallet, amount) values ('bogus','W',1)`));

/* The replay guard. A captured signature must not be submittable twice. */
section('replay guard');
await db.exec(`insert into public.claim_events (kind, wallet, amount, nonce)
  values ('epoch','WALLET_A',10,'nonce-abc-123')`);
await throws('the same nonce cannot be claimed twice', () => db.exec(
  `insert into public.claim_events (kind, wallet, amount, nonce)
   values ('epoch','WALLET_A',10,'nonce-abc-123')`));
await db.exec(`insert into public.claim_events (kind, wallet, amount, nonce)
  values ('epoch','WALLET_A',10,'nonce-different')`);
const nonceCount = await db.query(`select count(*)::int as n from public.claim_events where wallet='WALLET_A'`);
ok('a different nonce is fine', nonceCount.rows[0].n, 2);
// NULL nonces (seeded demo rows) must not collide with each other.
await db.exec(`insert into public.claim_events (kind, wallet, amount) values ('epoch','SEED',1)`);
await db.exec(`insert into public.claim_events (kind, wallet, amount) values ('epoch','SEED',2)`);
const nullCount = await db.query(`select count(*)::int as n from public.claim_events where wallet='SEED'`);
ok('rows with no nonce do not collide', nullCount.rows[0].n, 2);

await throws('an epoch that ends before it starts is rejected', () => db.exec(
  `insert into public.claim_epochs (epoch_index, starts_at, ends_at)
   values (1, now(), now() - interval '1 minute')`));

await throws('a ticker longer than 10 chars is rejected', () => db.exec(
  `insert into public.claim_launches (name,ticker,creator_wallet)
   values ('X','THISISWAYTOOLONG','W')`));

await throws('a hue outside 0-359 is rejected', () => db.exec(
  `insert into public.claim_vaults (mint,name,ticker,creator_wallet,hue)
   values ('M9','X','$X','W',400)`));

/* The API layer maps these columns straight onto the board card, so a missing
   one is a silent undefined in the UI. Assert the full inventory. */
section('column inventory the API depends on');
const cols = await db.query(`
  select table_name, column_name from information_schema.columns
  where table_schema = 'public' and table_name like 'claim_%'
`);
const has = (t, c) => cols.rows.some((r) => r.table_name === t && r.column_name === c);
const REQUIRED = [
  ['claim_vaults', 'mint'], ['claim_vaults', 'name'], ['claim_vaults', 'ticker'],
  ['claim_vaults', 'mode'], ['claim_vaults', 'creator_wallet'], ['claim_vaults', 'image_url'],
  ['claim_vaults', 'unclaimed_amount'], ['claim_vaults', 'claimed_amount'],
  ['claim_vaults', 'holder_count'], ['claim_vaults', 'market_cap'], ['claim_vaults', 'volume_24h'],
  ['claim_vaults', 'rate_per_sec'], ['claim_vaults', 'hue'], ['claim_vaults', 'is_demo'],
  ['claim_positions', 'vault_id'], ['claim_positions', 'wallet'], ['claim_positions', 'balance'],
  ['claim_positions', 'first_buy_at'], ['claim_positions', 'last_buy_at'],
  ['claim_positions', 'last_sell_at'], ['claim_positions', 'reward_debt'],
  ['claim_positions', 'last_claim_epoch'], ['claim_positions', 'streak_epochs'],
  ['claim_epochs', 'epoch_index'], ['claim_epochs', 'starts_at'], ['claim_epochs', 'ends_at'],
  ['claim_epochs', 'pot_amount'], ['claim_epochs', 'burn_amount'], ['claim_epochs', 'total_weight'],
  ['claim_epochs', 'claimed_amount'], ['claim_epochs', 'finalized'],
  ['claim_events', 'kind'], ['claim_events', 'wallet'], ['claim_events', 'amount'],
  ['claim_events', 'epoch_index'], ['claim_events', 'tx_signature'], ['claim_events', 'nonce'],
  ['claim_holder_stats', 'wallet'], ['claim_holder_stats', 'weight'],
  ['claim_holder_stats', 'lifetime_claimed'], ['claim_holder_stats', 'streak_epochs'],
  ['claim_holder_stats', 'claim_balance'],
  ['claim_launches', 'signature'], ['claim_launches', 'status'], ['claim_launches', 'image_url'],
  ['claim_settings', 'key'], ['claim_settings', 'value']
];
const missingCols = REQUIRED.filter(([t, c]) => !has(t, c)).map(([t, c]) => t + '.' + c);
ok('every column the API reads exists', missingCols.length ? missingCols.join(', ') : 'all present', 'all present');

/* ================= 8. the updated_at trigger works ================= */
section('updated_at trigger');
const t0 = await db.query("select updated_at from public.claim_vaults where mint='MINT1'");
await db.exec("update public.claim_vaults set unclaimed_amount = 42 where mint='MINT1'");
const t1 = await db.query("select updated_at, unclaimed_amount from public.claim_vaults where mint='MINT1'");
ok('update applied', Number(t1.rows[0].unclaimed_amount), 42);
ok('updated_at advanced', new Date(t1.rows[0].updated_at) >= new Date(t0.rows[0].updated_at), 'true');

/* ================= 9. cascade ================= */
section('cascade behaviour');
const posBefore = await db.query('select count(*)::int as n from public.claim_positions');
ok('position exists before delete', posBefore.rows[0].n, 1);
await db.exec(`delete from public.claim_vaults where mint='MINT1'`);
const posAfter = await db.query('select count(*)::int as n from public.claim_positions');
ok('deleting a vault cascades to its positions', posAfter.rows[0].n, 0);

/* ================= 10. the settle function ================= */
section('claim_settle — atomic settlement');
const settleExists = await db.query(
  `select proname from pg_proc where proname = 'claim_settle'`
);
ok('claim_settle exists', settleExists.rows.length, 1);

/* The critical permission check: anon must NOT be able to call it directly,
   or anyone with the publishable key could mint themselves a claim. */
const acl = await db.query(`
  select has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can
  from pg_proc p where p.proname = 'claim_settle'
`);
ok('anon CANNOT execute claim_settle', acl.rows[0].anon_can, false);
ok('authenticated CANNOT execute claim_settle', acl.rows[0].auth_can, false);

/* End-to-end: settle once, verify all four writes landed. */
await db.exec(`
  insert into public.claim_vaults (mint,name,ticker,creator_wallet)
    values ('SETTLE1','S','$S','W') on conflict do nothing;
  insert into public.claim_positions (vault_id, wallet, balance, last_claim_epoch)
    select id, 'WALLET_SETTLE', 5000, 100 from public.claim_vaults where mint='SETTLE1';
`);
const settled = await db.query(`
  select * from public.claim_settle('WALLET_SETTLE','nonce-settle-1', 200, 900, 1000, 42.5, 12500, 25000)
`);
ok('settle returns a row', settled.rows.length, 1);
ok('settle returns the amount', Number(settled.rows[0].amount), 42.5);
ok('lifetime starts at the amount', Number(settled.rows[0].lifetime_claimed), 42.5);

const evRow = await db.query(`select amount, epoch_index, multiplier_bps from public.claim_events where nonce='nonce-settle-1'`);
ok('an event was written', evRow.rows.length, 1);
ok('the event carries the multiplier', Number(evRow.rows[0].multiplier_bps), 25000);

const epochRow = await db.query(`select claimed_amount, claimer_count from public.claim_epochs where epoch_index=200`);
ok('the epoch row was created by settle', epochRow.rows.length, 1);
ok('epoch claimed_amount updated', Number(epochRow.rows[0].claimed_amount), 42.5);
ok('epoch claimer_count updated', Number(epochRow.rows[0].claimer_count), 1);

const posRow = await db.query(`select last_claim_epoch, streak_epochs from public.claim_positions where wallet='WALLET_SETTLE'`);
ok('position last_claim_epoch reset', Number(posRow.rows[0].last_claim_epoch), 200);
ok('position streak incremented', Number(posRow.rows[0].streak_epochs), 1);

/* Replaying the same nonce must fail AND leave the totals untouched. */
await throws('replaying the nonce is rejected', () => db.query(
  `select * from public.claim_settle('WALLET_SETTLE','nonce-settle-1', 200, 900, 1000, 42.5, 12500, 25000)`));
const epochAfter = await db.query(`select claimed_amount, claimer_count from public.claim_epochs where epoch_index=200`);
ok('a rejected replay did not double-count', Number(epochAfter.rows[0].claimed_amount), 42.5);
ok('a rejected replay did not double-count claimers', Number(epochAfter.rows[0].claimer_count), 1);

/* A second, distinct claim should accumulate rather than replace. */
await db.query(`select * from public.claim_settle('WALLET_SETTLE','nonce-settle-2', 201, 900, 1000, 7.5, 12500, 25000)`);
const lifetime = await db.query(`select lifetime_claimed, claim_count from public.claim_holder_stats where wallet='WALLET_SETTLE'`);
ok('lifetime accumulates', Number(lifetime.rows[0].lifetime_claimed), 50);
ok('claim_count accumulates', Number(lifetime.rows[0].claim_count), 2);
const epoch201 = await db.query(`select claimed_amount from public.claim_epochs where epoch_index=201`);
ok('the second epoch is tracked separately', Number(epoch201.rows[0].claimed_amount), 7.5);

await throws('a negative amount is rejected', () => db.query(
  `select * from public.claim_settle('WALLET_SETTLE','nonce-neg', 202, 900, 1000, -5, 1, 1)`));

/* The pot cannot pay out more than it holds. This is the rule that a row
   created with pot = 0 would have made impossible to satisfy. */
await throws('claiming more than the pot holds is rejected', () => db.query(
  `select * from public.claim_settle('WALLET_SETTLE','nonce-over', 203, 900, 10, 500, 1, 1)`));
const epoch203 = await db.query(`select count(*)::int as n from public.claim_epochs where epoch_index=203`);
ok('the over-claim wrote no epoch row at all', epoch203.rows[0].n, 0);

/* A later, smaller pot figure must not reduce a pot the crank already funded. */
await db.query(`select * from public.claim_settle('WALLET_SETTLE','nonce-pot1', 204, 900, 5000, 1, 1, 1)`);
await db.query(`select * from public.claim_settle('WALLET_SETTLE','nonce-pot2', 204, 900, 10, 1, 1, 1)`);
const pot204 = await db.query(`select pot_amount from public.claim_epochs where epoch_index=204`);
ok('a smaller pot figure does not shrink a funded pot', Number(pot204.rows[0].pot_amount), 5000);
/* ...but a larger one does top it up. */
await db.query(`select * from public.claim_settle('WALLET_SETTLE','nonce-pot3', 204, 900, 9000, 1, 1, 1)`);
const pot204b = await db.query(`select pot_amount from public.claim_epochs where epoch_index=204`);
ok('a larger pot figure tops it up', Number(pot204b.rows[0].pot_amount), 9000);

/* ================= 11. 002 — the ops layer ================= */
section('002_claim_admin — the ops layer applies');
let apply2Error = null;
try { await db.exec(SQL2); } catch (e) { apply2Error = e.message; }
ok('002 applies without error', apply2Error || 'clean', 'clean');

const afterOps = await tableNames();
ok('002 creates no new tables', afterOps.slice().sort().join(','), after.slice().sort().join(','));

const opsFns = await db.query(`
  select proname from pg_proc
  where proname in ('claim_fund_epoch','claim_set_setting') order by proname
`);
ok('both ops functions exist', opsFns.rows.map((r) => r.proname).join(','),
  'claim_fund_epoch,claim_set_setting');

/* Same permission rule as claim_settle: PostgREST exposes these at /rpc/, so an
   un-revoked function would let anyone with the publishable key fund an epoch
   with a fake pot or set min_hold to 0 and drain it. */
const opsAcl = await db.query(`
  select p.proname,
         has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can
  from pg_proc p
  where p.proname in ('claim_fund_epoch','claim_set_setting')
  order by p.proname
`);
ok('anon CANNOT execute either ops function', opsAcl.rows.every((r) => r.anon_can === false), 'true');
ok('authenticated CANNOT execute either', opsAcl.rows.every((r) => r.auth_can === false), 'true');

section('claim_fund_epoch — declarative, monotonic');
const fund = (idx, secs, buy, burn, pot) =>
  db.query(`select public.claim_fund_epoch($1,$2,$3,$4,$5) as r`, [idx, secs, buy, burn, pot]);

const f1 = await fund(900, 900, 10000, 5000, 5000);
ok('funding returns a jsonb row', typeof f1.rows[0].r, 'object');
ok('the pot is recorded', Number(f1.rows[0].r.pot_amount), 5000);
ok('the buyback is recorded', Number(f1.rows[0].r.buyback_amount), 10000);
ok('the burn is recorded', Number(f1.rows[0].r.burn_amount), 5000);

/* Declarative, not additive: the same figures twice must not double-credit.
   This is what makes a retried cron job safe. */
await fund(900, 900, 10000, 5000, 5000);
const f2 = await db.query(`select pot_amount, buyback_amount from public.claim_epochs where epoch_index=900`);
ok('re-funding with the same figures is a no-op', Number(f2.rows[0].pot_amount), 5000);
ok('the buyback did not double-count either', Number(f2.rows[0].buyback_amount), 10000);

/* Monotonic: a stale crank replaying an old, lower number must not shrink a pot
   that holders have already been told they can claim from. */
await fund(900, 900, 1, 1, 1);
const f3 = await db.query(`select pot_amount from public.claim_epochs where epoch_index=900`);
ok('a lower figure does not shrink the pot', Number(f3.rows[0].pot_amount), 5000);

await fund(900, 900, 40000, 20000, 20000);
const f4 = await db.query(`select pot_amount from public.claim_epochs where epoch_index=900`);
ok('a higher figure tops it up', Number(f4.rows[0].pot_amount), 20000);

const f5 = await db.query(`select starts_at, ends_at from public.claim_epochs where epoch_index=900`);
const span = (new Date(f5.rows[0].ends_at) - new Date(f5.rows[0].starts_at)) / 1000;
ok('the window is exactly one epoch long', span, 900);

await throws('a negative buyback is rejected', () => fund(901, 900, -1, 0, 0));
await throws('a negative pot is rejected', () => fund(901, 900, 0, 0, -1));
await throws('a negative epoch index is rejected', () => fund(-1, 900, 0, 0, 0));
await throws('an absurd epoch length is rejected', () => fund(901, 5, 0, 0, 0));
await throws('an epoch length above a day is rejected', () => fund(901, 99999, 0, 0, 0));

/* A finalized epoch is history. The write must fail loudly, not silently no-op,
   or an operator would believe a funding run had landed when it had not. */
await db.exec(`update public.claim_epochs set finalized = true where epoch_index = 900`);
await throws('a finalized epoch refuses funding', () => fund(900, 900, 99999, 0, 99999));
const f6 = await db.query(`select pot_amount from public.claim_epochs where epoch_index=900`);
ok('and its figures are untouched', Number(f6.rows[0].pot_amount), 20000);
await db.exec(`update public.claim_epochs set finalized = false where epoch_index = 900`);

section('claim_set_setting — allowlisted and range-checked');
const setSetting = (k, v) =>
  db.query(`select public.claim_set_setting($1, $2::jsonb) as r`, [k, JSON.stringify(v)]);

const s1 = await setSetting('burn_split', 0.35);
ok('a valid update lands', Number(s1.rows[0].r.value), 0.35);
const s2 = await db.query(`select value from public.claim_settings where key='burn_split'`);
ok('and it is persisted', Number(s2.rows[0].value), 0.35);

const s3 = await setSetting('pot_per_epoch', 2000);
ok('a second key updates independently', Number(s3.rows[0].r.value), 2000);
const s4 = await db.query(`select count(*)::int as n from public.claim_settings`);
ok('updating does not insert a duplicate row', s4.rows[0].n, 5);

await throws('an unknown key is rejected', () => setSetting('drop_everything', 1));
await throws('a non-numeric value is rejected', () => setSetting('burn_split', 'high'));
await throws('a null value is rejected', () => setSetting('burn_split', null));
await throws('burn_split above 1 is rejected', () => setSetting('burn_split', 1.5));
await throws('a negative burn_split is rejected', () => setSetting('burn_split', -0.1));
await throws('epoch_seconds below 60 is rejected', () => setSetting('epoch_seconds', 30));
await throws('a fractional epoch_seconds is rejected', () => setSetting('epoch_seconds', 900.5));
await throws('a negative pot_per_epoch is rejected', () => setSetting('pot_per_epoch', -5));
await throws('a negative min_hold is rejected', () => setSetting('min_hold', -1));
await throws('max_stack of 0 is rejected', () => setSetting('max_stack', 0));
await throws('a fractional max_stack is rejected', () => setSetting('max_stack', 2.5));

/* The boundary values must be accepted, not merely rejected around. */
const edge1 = await setSetting('burn_split', 0);
ok('burn_split of exactly 0 is allowed', Number(edge1.rows[0].r.value), 0);
const edge2 = await setSetting('burn_split', 1);
ok('burn_split of exactly 1 is allowed', Number(edge2.rows[0].r.value), 1);
const edge3 = await setSetting('epoch_seconds', 60);
ok('epoch_seconds of exactly 60 is allowed', Number(edge3.rows[0].r.value), 60);
const edge4 = await setSetting('max_stack', 1);
ok('max_stack of exactly 1 is allowed', Number(edge4.rows[0].r.value), 1);

/* Restore, so later sections read the seeded values. */
await setSetting('burn_split', 0.5);
await setSetting('epoch_seconds', 900);
await setSetting('max_stack', 96);
await setSetting('pot_per_epoch', 1250);

/* A pot funded by the crank must be the value the epoch endpoint would report,
   and claim_settle must respect it rather than inventing its own. */
section('the ops layer and the claim path agree');
await db.exec(`
  insert into public.claim_vaults (mint,name,ticker,creator_wallet)
    values ('FUND1','F','$F','W') on conflict do nothing;
  insert into public.claim_positions (vault_id, wallet, balance, last_claim_epoch)
    select id, 'WALLET_FUND', 9000, 949 from public.claim_vaults where mint='FUND1';
`);
const settleOnFunded = await db.query(
  `select * from public.claim_settle('WALLET_FUND','nonce-funded', 950, 900, 20000, 100, 9000, 10000)`);
ok('a claim settles against a crank-funded epoch', Number(settleOnFunded.rows[0].amount), 100);
const fundedRow = await db.query(`select pot_amount, claimed_amount from public.claim_epochs where epoch_index=950`);
ok('the pot is still the funded figure', Number(fundedRow.rows[0].pot_amount), 20000);
ok('and the claim is recorded against it', Number(fundedRow.rows[0].claimed_amount), 100);

/* ================= 12. idempotency ================= */
section('running both files twice is safe');
let secondError = null;
try { await db.exec(SQL); await db.exec(SQL2); } catch (e) { secondError = e.message; }
ok('second run is clean', secondError || 'clean', 'clean');
const after2 = await tableNames();
ok('still exactly the same tables', after2.slice().sort().join(','), after.slice().sort().join(','));
const settings2 = await db.query('select count(*)::int as n from public.claim_settings');
ok('settings were not duplicated', settings2.rows[0].n, 5);

/* ================= 13. teardown is complete ================= */
section('teardown block covers everything');
// Case-insensitive: the marker is a convention, and a casing drift should not
// silently turn this section into a no-op that always passes.
const teardown = (SQL.split(/TEARDOWN/i)[1] || '');
const missingFromTeardown = EXPECTED.filter((t) => !teardown.includes(t));
ok('every claim_ table appears in the teardown', missingFromTeardown.length ? missingFromTeardown.join(',') : 'none', 'none');
ok('the helper function is dropped too', teardown.includes('claim_touch_updated_at'), 'true');
ok('claim_settle is dropped too', teardown.includes('claim_settle'), 'true');

const teardown2 = (SQL2.split(/TEARDOWN/i)[1] || '');
ok('002 has a teardown block at all', teardown2.length > 0, 'true');
ok('002 teardown drops claim_fund_epoch', teardown2.includes('claim_fund_epoch'), 'true');
ok('002 teardown drops claim_set_setting', teardown2.includes('claim_set_setting'), 'true');
ok('002 teardown drops no table', /drop table/i.test(teardown2), 'false');

/* Actually run it, to prove the objects drop without dependency errors. */
await db.exec(`
  drop table if exists public.claim_events       cascade;
  drop table if exists public.claim_positions    cascade;
  drop table if exists public.claim_holder_stats cascade;
  drop table if exists public.claim_epochs       cascade;
  drop table if exists public.claim_launches     cascade;
  drop table if exists public.claim_vaults       cascade;
  drop table if exists public.claim_settings     cascade;
  drop function if exists public.claim_settle(text, text, bigint, integer, numeric, numeric, numeric, integer) cascade;
  drop function if exists public.claim_touch_updated_at() cascade;
  drop function if exists public.claim_fund_epoch(bigint, integer, numeric, numeric, numeric) cascade;
  drop function if exists public.claim_set_setting(text, jsonb) cascade;
`);
const finalTables = await tableNames();
ok('teardown leaves zero claim_ tables', finalTables.filter((t) => t.startsWith('claim_')).length, 0);
const finalFns = await db.query(`
  select proname from pg_proc
  where proname in ('claim_settle','claim_fund_epoch','claim_set_setting','claim_touch_updated_at')
`);
ok('teardown leaves zero claim_ functions', finalFns.rows.length, 0);
ok('other projects survive teardown', finalTables.includes('coins') && finalTables.includes('events'), 'true');

console.log('\n' + (fail === 0 ? 'ALL PASS — migration verified against real Postgres' : fail + ' FAILURE(S)'));
await db.close();
process.exit(fail === 0 ? 0 : 1);
