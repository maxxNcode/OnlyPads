/* ==========================================================================
   CLAIM — api/health.js
   GET /api/health

   The first thing to hit after a deploy. Reports which secrets are present
   (never their values), whether the database is reachable, and whether all
   seven onlypad_* tables actually exist.

   Safe to leave public: it exposes presence flags and table names, nothing
   that could be used to authenticate.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');
var db = require('./_lib/db');

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET'])) return;

  var report = env.describe();

  if (!env.dbConfigured()) {
    return http.send(res, 200, {
      ok: false,
      status: 'not_configured',
      hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project settings, then redeploy.',
      config: report
    });
  }

  var probe = await db.ping();

  // Tell the operator which of the two problems they actually have. A health
  // check that cannot distinguish "run the migration" from "your key is wrong"
  // just wastes their time.
  var hint = null;
  if (!probe.ok) {
    if (probe.cause === 'connection') {
      hint = 'Could not reach the database: ' + probe.error +
        '. Check SUPABASE_URL and that SUPABASE_SERVICE_ROLE_KEY is the service_role key, not the anon key.';
    } else if (probe.missing && probe.missing.length === 7) {
      hint = 'Connected to ' + (env.supabaseUrl() || 'the database') +
        ' successfully, but none of the onlypad_* tables exist yet. ' +
        'Run db/migrations/001_onlypad_schema.sql in the Supabase SQL editor. ' +
        'It only creates onlypad_* tables and will not touch your other projects.';
    } else if (probe.missing && probe.missing.length) {
      hint = 'Connected, but these tables are missing: ' + probe.missing.join(', ') +
        '. Run db/migrations/001_onlypad_schema.sql in the Supabase SQL editor.';
    }
  }

  return http.send(res, probe.ok ? 200 : 503, {
    ok: probe.ok,
    status: probe.ok ? 'healthy' : (probe.cause === 'schema' ? 'schema_missing' : 'database_error'),
    hint: hint,
    database: {
      reachable: probe.ok || probe.cause === 'schema',
      tables: probe.present || null,
      missing: probe.missing || null
    },
    config: report
  });
});
