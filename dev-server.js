/* ==========================================================================
   ONLYPAD — dev-server.js
   Runs the static site AND the api/* handlers on one port, so the whole thing
   can be exercised locally without deploying or logging into Vercel.

   It mimics just enough of Vercel's contract: a request to /api/foo is handed
   to api/foo.js with (req, res), where req.query is parsed and req.body is a
   parsed object for JSON POSTs.

   Zero dependencies. Reads .env if it exists.

   Run: node dev-server.js       →  http://localhost:5173
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

/* ---------- load .env without a dependency ---------- */
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
  console.log('  loaded .env');
} else {
  console.log('  no .env — the API will report itself unconfigured');
}

/* ---------- static ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.join(ROOT, rel);

  // Never serve outside the project, and never serve the secrets.
  if (!full.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  const base = path.basename(full);
  if (base === '.env' || base.startsWith('.env.')) { res.statusCode = 404; return res.end('not found'); }
  if (rel.startsWith('/.git') || rel.startsWith('/api/')) { res.statusCode = 404; return res.end('not found'); }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('not found: ' + rel);
    }
    res.setHeader('Content-Type', TYPES[path.extname(full)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
}

/* ---------- api ---------- */
/*
 * Reload a module only when its file has ACTUALLY changed.
 *
 * This used to delete the whole api/ tree from the require cache on every
 * request. That picked up edits to api/_lib/* without a restart — which is why
 * it was written — but it also destroyed every module-level cache between
 * requests. _lib/pumpfun.js caches the pump.fun index for a minute; under the
 * old behaviour that cache was thrown away and rebuilt on each request, so the
 * local server hammered the upstream and behaved nothing like the deployed one,
 * where a warm instance keeps its state.
 *
 * Tracking mtimes keeps both properties: an edit is picked up immediately, and
 * an unedited module keeps its cache.
 */
const mtimes = new Map();

function purgeChanged(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { purgeChanged(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    let m;
    try { m = fs.statSync(full).mtimeMs; } catch (e) { continue; }
    if (mtimes.get(full) !== m) {
      mtimes.set(full, m);
      try { delete require.cache[require.resolve(full)]; } catch (e) { /* not loaded yet */ }
    }
  }
}

function loadHandler(name) {
  const file = path.join(ROOT, 'api', name + '.js');
  if (!fs.existsSync(file)) return null;
  try {
    purgeChanged(path.join(ROOT, 'api'));
    const mod = require(file);
    return mod.default || mod;
  } catch (e) {
    console.error('  failed to load api/' + name + '.js:', e.message);
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { resolve(undefined); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    /*
     * Every launched coin has its own page at /coin/<mint>. There is no file at
     * that path — coin.html reads the mint out of the URL — so this mirrors the
     * rewrite in vercel.json. Without it the route works in production and 404s
     * locally, which is the worst way round for it to be broken.
     */
    if (/^\/coin\/[^/]+\/?$/.test(pathname)) return serveStatic(req, res, '/coin.html');
    return serveStatic(req, res, pathname);
  }

  const name = pathname.slice(5).replace(/\/+$/, '');
  if (!/^[a-z0-9_-]+$/i.test(name)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: { code: 'bad_path', message: 'bad endpoint name' } }));
  }

  const handler = loadHandler(name);
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'no such endpoint: /api/' + name } }));
  }

  req.query = {};
  url.searchParams.forEach((v, k) => { req.query[k] = v; });
  req.body = await readBody(req);

  const started = Date.now();
  const originalEnd = res.end.bind(res);
  res.end = function (body) {
    const ms = Date.now() - started;
    console.log('  ' + String(res.statusCode).padEnd(4) + req.method.padEnd(5) + pathname.padEnd(28) + ms + 'ms');
    return originalEnd(body);
  };

  try {
    await handler(req, res);
  } catch (e) {
    console.error('  handler threw:', e && e.stack ? e.stack : e);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'handler threw' } }));
    }
  }
});

server.listen(PORT, () => {
  console.log('\n  ONLYPAD dev server');
  console.log('  ─────────────────────────────────────────────');
  console.log('  site   http://localhost:' + PORT);
  console.log('  api    http://localhost:' + PORT + '/api/health');
  console.log('  press Ctrl+C to stop\n');
});
