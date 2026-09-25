/* ==========================================================================
   CLAIM — api/_lib/db.js
   A minimal PostgREST client built on fetch. No dependencies, so the site
   keeps its zero-dependency property and Vercel needs no build step.

   Every call uses the SERVICE ROLE key, which bypasses RLS. That is correct
   for a server-side function and catastrophic anywhere else — see env.js.
   ========================================================================== */
var env = require('./env');

var TIMEOUT_MS = 8000;

function baseUrl() {
  var u = env.supabaseUrl();
  if (!u) throw new Error('SUPABASE_URL is not configured');
  return u.replace(/\/+$/, '') + '/rest/v1';
}

function headers(extra) {
  var key = env.serviceKey();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  var h = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
  return h;
}

/** Build a PostgREST query string from a plain object. */
function qs(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/**
 * One HTTP call against PostgREST.
 * Never throws on an HTTP error status — returns a shaped result instead, so
 * endpoints can decide how to degrade.
 */
async function request(path, options) {
  options = options || {};
  var url = baseUrl() + '/' + path + qs(options.query);
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);

  try {
    var res = await fetch(url, {
      method: options.method || 'GET',
      headers: headers(options.headers),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: ctl ? ctl.signal : undefined
    });
    clearTimeout(timer);

    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }

    if (!res.ok) {
      var msg = (data && (data.message || data.hint || data.error)) || ('HTTP ' + res.status);
      return { ok: false, status: res.status, error: msg, details: data };
    }
    return { ok: true, status: res.status, data: data };
  } catch (e) {
    clearTimeout(timer);
    var reason = e && e.name === 'AbortError' ? 'request timed out after ' + TIMEOUT_MS + 'ms' : (e && e.message) || String(e);
    return { ok: false, status: 0, error: reason };
  }
}

/* ================= convenience wrappers ================= */

/**
 * select('onlypad_vaults', { select: '*', eq: { mode: 'stream' }, order: 'unclaimed_amount.desc', limit: 12 })
 */
function select(table, opts) {
  opts = opts || {};
  var query = { select: opts.select || '*' };
  var k;
  if (opts.eq) for (k in opts.eq) query[k] = 'eq.' + opts.eq[k];
  if (opts.neq) for (k in opts.neq) query[k] = 'neq.' + opts.neq[k];
  if (opts.gt) for (k in opts.gt) query[k] = 'gt.' + opts.gt[k];
  if (opts.gte) for (k in opts.gte) query[k] = 'gte.' + opts.gte[k];
  if (opts.lt) for (k in opts.lt) query[k] = 'lt.' + opts.lt[k];
  if (opts.in) for (k in opts.in) query[k] = 'in.(' + opts.in[k].join(',') + ')';
  if (opts.ilike) for (k in opts.ilike) query[k] = 'ilike.' + opts.ilike[k];
  if (opts.or) query.or = '(' + opts.or + ')';
  if (opts.order) query.order = opts.order;
  if (opts.limit) query.limit = String(opts.limit);
  if (opts.offset) query.offset = String(opts.offset);

  return request(table, { query: query, headers: opts.count ? { Prefer: 'count=exact' } : undefined });
}

function insert(table, rows, opts) {
  opts = opts || {};
  var prefer = ['return=representation'];
  if (opts.upsert) prefer.push('resolution=merge-duplicates');
  var query = {};
  if (opts.onConflict) query.on_conflict = opts.onConflict;
  if (opts.select) query.select = opts.select;
  return request(table, {
    method: 'POST',
    query: query,
    body: rows,
    headers: { Prefer: prefer.join(',') }
  });
}

function update(table, patch, opts) {
  opts = opts || {};
  var query = { select: opts.select || 'id' };
  for (var k in opts.eq || {}) query[k] = 'eq.' + opts.eq[k];
  return request(table, {
    method: 'PATCH',
    query: query,
    body: patch,
    headers: { Prefer: 'return=representation' }
  });
}

/** Call a Postgres function. Used for anything that must be atomic. */
function rpc(fn, args) {
  return request('rpc/' + fn, { method: 'POST', body: args || {} });
}

/**
 * The column each table is probed with.
 *
 * Not every table has an `id`: `onlypad_settings` is keyed on `key`, so probing it
 * with `select=id` asks PostgREST for a column that does not exist. That answers
 * 400 rather than 404, which this function reads as a connection failure — so the
 * health check used to report a perfectly healthy settings table as MISSING and
 * tell the operator to re-run a migration that had already been applied.
 */
var PROBE_COLUMN = {
  onlypad_coins: 'id',
  onlypad_escrow: 'id',
  onlypad_events: 'id',
  onlypad_settings: 'key'
};

/**
 * Connectivity + schema probe used by /api/health.
 *
 * Probes each table individually rather than stopping at the first failure.
 * That distinction matters operationally: PostgREST answers a missing table
 * with a 404, whereas bad credentials or a bad URL produce something else. The
 * first means "run the migration", the second means "fix the environment" —
 * and a health check that cannot tell them apart is not much of a health check.
 */
async function ping() {
  if (!env.dbConfigured()) {
    return { ok: false, error: 'database is not configured (missing URL or service key)' };
  }

  var tables = Object.keys(PROBE_COLUMN);

  var present = {};
  var missing = [];
  var hardError = null;
  var hardStatus = null;

  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    var probe = await select(t, { select: PROBE_COLUMN[t], limit: 1 });

    if (probe.ok) { present[t] = true; continue; }

    if (probe.status === 404) {
      // PostgREST says the table is not in the schema cache: it does not exist.
      present[t] = false;
      missing.push(t);
      continue;
    }

    // Anything else — 401, 403, a network failure — is not about the schema.
    present[t] = false;
    missing.push(t);
    if (!hardError) { hardError = probe.error; hardStatus = probe.status; }
  }

  if (hardError && missing.length === tables.length) {
    return { ok: false, error: hardError, status: hardStatus, present: present, missing: missing, cause: 'connection' };
  }

  return {
    ok: missing.length === 0,
    present: present,
    missing: missing,
    cause: missing.length ? 'schema' : null,
    error: hardError
  };
}

module.exports = {
  request: request,
  select: select,
  insert: insert,
  update: update,
  rpc: rpc,
  ping: ping,
  qs: qs
};
