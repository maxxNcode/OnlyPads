/* ==========================================================================
   CLAIM — api/_lib/http.js
   Request/response plumbing shared by every endpoint: CORS, JSON bodies,
   method guards and a single consistent error shape.
   ========================================================================== */

/** The shape every failure takes, so the client only has one thing to parse. */
function fail(res, status, code, message, extra) {
  var body = { ok: false, error: { code: code, message: message } };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body.error[k] = extra[k];
  return send(res, status, body);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return body;
}

function ok(res, payload, cacheSeconds) {
  if (cacheSeconds) {
    res.setHeader('Cache-Control', 'public, max-age=' + cacheSeconds + ', s-maxage=' + cacheSeconds + ', stale-while-revalidate=' + cacheSeconds * 4);
  }
  return send(res, 200, payload);
}

/**
 * CORS. The read endpoints are public data and are safe to open up. The write
 * endpoints are protected by a wallet signature, not by an origin check —
 * an Origin header is trivially forged, so it would be security theatre to
 * rely on it. See api/claim.js.
 */
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

/** Returns true (and has already responded) when the method is not allowed. */
function methodNotAllowed(req, res, allowed) {
  if (allowed.indexOf(req.method) !== -1) return false;
  res.setHeader('Allow', allowed.join(', '));
  fail(res, 405, 'method_not_allowed', 'This endpoint accepts ' + allowed.join(' and ') + '.');
  return true;
}

/** Parse a JSON body, with a size ceiling so a huge POST cannot exhaust memory. */
const MAX_BODY = 64 * 1024;

/**
 * The ceiling for endpoints that legitimately carry an image.
 *
 * Vercel caps a serverless request body at 4.5 MB, and a base64 data URL costs
 * about 4/3 of the bytes it carries, so a 2 MB image arrives as roughly 2.7 MB.
 * That leaves headroom for the metadata JSON and the multipart framing.
 */
const MAX_UPLOAD_BODY = 3 * 1024 * 1024;

function readJson(req, maxBytes) {
  const limit = maxBytes || MAX_BODY;
  return new Promise(function (resolve) {
    // Vercel parses JSON bodies for us in most configurations.
    if (req.body && typeof req.body === 'object') return resolve({ ok: true, value: req.body });
    if (typeof req.body === 'string') {
      if (req.body.length > limit) return resolve({ ok: false, error: 'body too large' });
      try { return resolve({ ok: true, value: JSON.parse(req.body) }); }
      catch (e) { return resolve({ ok: false, error: 'body is not valid JSON' }); }
    }

    var chunks = [];
    var size = 0;
    var done = false;
    function finish(r) { if (!done) { done = true; resolve(r); } }

    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { finish({ ok: false, error: 'body too large' }); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return finish({ ok: true, value: {} });
      try { finish({ ok: true, value: JSON.parse(raw) }); }
      catch (e) { finish({ ok: false, error: 'body is not valid JSON' }); }
    });
    req.on('error', function () { finish({ ok: false, error: 'could not read request body' }); });
  });
}

/** Query params as a plain object, regardless of how Vercel hands them over. */
function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    var u = new URL(req.url, 'http://localhost');
    var out = {};
    u.searchParams.forEach(function (v, k) { out[k] = v; });
    return out;
  } catch (e) {
    return {};
  }
}

/**
 * Wrap a handler so an unexpected throw becomes a clean 500, never a stack trace.
 *
 * Pass `{ cors: false }` for endpoints that are not meant to be called from a
 * browser at all. api/admin.js is the only one: it is authenticated by a shared
 * secret rather than by an origin, so there is nothing to gain from letting a
 * page reach it, and a same-origin-only surface is one fewer way in.
 */
function handler(fn, opts) {
  var useCors = !opts || opts.cors !== false;
  return async function (req, res) {
    try {
      if (useCors && cors(req, res)) return;
      await fn(req, res);
    } catch (e) {
      // Never leak internals to the client; log for the Vercel function log.
      console.error('[onlypad api] unhandled', e && e.stack ? e.stack : e);
      if (!res.writableEnded) {
        fail(res, 500, 'internal_error', 'Something went wrong handling this request.');
      }
    }
  };
}

module.exports = {
  send: send,
  ok: ok,
  fail: fail,
  cors: cors,
  methodNotAllowed: methodNotAllowed,
  readJson: readJson,
  query: query,
  handler: handler,
  MAX_BODY: MAX_BODY,
  MAX_UPLOAD_BODY: MAX_UPLOAD_BODY
};
