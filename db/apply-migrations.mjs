/**
 * apply-migrations.mjs — apply db/migrations/*.sql in order.
 *
 *   node db/apply-migrations.mjs            # apply
 *   node db/apply-migrations.mjs --dry      # list what would run
 *   node db/apply-migrations.mjs --verify   # report the live schema, change nothing
 *
 * Uses SUPABASE_DB_URL from .env, which connects as the table owner and therefore
 * bypasses row level security. That is what a migration needs, and it is also why
 * this is the only script in the project that reads that variable — the running
 * site never does.
 *
 * ---------------------------------------------------------------------------
 * THIS DATABASE IS SHARED WITH OTHER PROJECTS
 * ---------------------------------------------------------------------------
 *
 * Every object this project creates is prefixed `claim_`. The `--verify` mode
 * exists mainly to prove that is still true: it lists any non-`claim_` table the
 * migrations would have touched, and refuses to call the run clean if it finds one.
 *
 * Each file is written to be idempotent, so re-running is safe.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// pg is CJS; createRequire rather than a bare import, so this behaves the same on
// every Node version rather than depending on interop.
const require = createRequire(path.join(root, 'package.json'));
const { Client } = require('pg');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const verifyOnly = args.includes('--verify');

/** Read .env by hand — Node has no built-in dotenv and this is four lines. */
function readEnv() {
  try {
    const raw = readFileSync(path.join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]] && value) process.env[m[1]] = value;
    }
  } catch {
    /* no .env — the variable may still be in the environment */
  }
}

readEnv();

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('\nSUPABASE_DB_URL is not set. Add it to .env, or export it.\n');
  process.exit(1);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const q = async (text, params) => (await client.query(text, params)).rows;

/** The tables this project is allowed to own. Anything else is somebody else's. */
const OURS = ['claim_vaults', 'claim_positions', 'claim_epochs', 'claim_events',
  'claim_holder_stats', 'claim_launches', 'claim_settings', 'claim_coins'];

async function verify() {
  console.log('  tables this project owns:');
  for (const name of OURS) {
    const cols = await q(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [name]
    );
    if (!cols.length) {
      console.log(`    public.${name}: MISSING`);
      continue;
    }
    const [rls] = await q(
      `select relrowsecurity as enabled from pg_class where oid = to_regclass($1)`,
      [`public.${name}`]
    );
    const policies = await q(
      `select policyname, cmd from pg_policies where schemaname = 'public' and tablename = $1`,
      [name]
    );
    const [{ count }] = await q(`select count(*)::int as count from public.${name}`);
    console.log(
      `    public.${name}: ${cols.length} cols · RLS ${rls.enabled ? 'on' : 'OFF'} · ` +
      `policies ${policies.length ? policies.map((p) => `${p.policyname}(${p.cmd})`).join(', ') : 'NONE'} · ` +
      `${count} row${count === 1 ? '' : 's'}`
    );
  }

  console.log('\n  functions this project owns:');
  for (const fn of ['claim_touch_updated_at', 'claim_settle', 'claim_fund_epoch',
    'claim_set_setting', 'claim_record_coin']) {
    const rows = await q(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [fn]
    );
    console.log(`    public.${fn}(): ${rows.length ? 'present' : 'MISSING'}`);
  }

  /*
   * The check that actually matters for a shared database: did this project
   * create anything it did not prefix? A `claim_`-less object here means a
   * migration reached outside its own namespace, which is the one failure mode
   * that could hurt another project.
   */
  const foreign = await q(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename like 'claim%' and tablename not like 'claim_%'`
  );
  const stray = await q(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'claim%' and p.proname not like 'claim_%'`
  );
  if (foreign.length || stray.length) {
    console.log('\n  UNPREFIXED OBJECTS FOUND — this project must only create claim_*:');
    foreign.forEach((r) => console.log(`    table ${r.tablename}`));
    stray.forEach((r) => console.log(`    function ${r.proname}`));
    return false;
  }
  console.log('\n  every object this project created is claim_-prefixed. Nothing else was touched.');
  return true;
}

async function main() {
  await client.connect();
  const label = url.replace(/:\/\/[^@]*@/, '://***@').split('@').pop().split('/')[0];
  console.log(`\nconnected to ${label}\n`);

  if (verifyOnly) {
    console.log('live schema:');
    const clean = await verify();
    await client.end();
    process.exit(clean ? 0 : 1);
  }

  const dir = path.join(root, 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) {
    console.error('No .sql files in db/migrations/');
    process.exit(1);
  }

  if (dry) {
    console.log('would apply, in order:');
    files.forEach((f) => console.log(`  ${f}`));
    await client.end();
    return;
  }

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    process.stdout.write(`  applying ${file} … `);
    // One transaction per file: a file that fails leaves nothing half-applied.
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
      console.log('ok');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${err.message}\n`);
      await client.end();
      process.exit(1);
    }
  }

  console.log('\nverifying:');
  const clean = await verify();
  await client.end();
  console.log(clean ? '\ndone.\n' : '\ndone, BUT see the warning above.\n');
  process.exit(clean ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\n${err.message}\n`);
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
