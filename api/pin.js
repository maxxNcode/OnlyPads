/* ==========================================================================
   CLAIM — api/pin.js
   GET  /api/pin   → is pinning configured?
   POST /api/pin   → pin a coin's image and metadata JSON to IPFS.

   WHY THIS EXISTS AT ALL

   A pump.fun coin carries only a URI string on-chain, and that string is
   permanent. The JSON behind it has to stay fetchable forever, which means IPFS,
   which means a pinning credential. There is no keyless write path — measured:
   ipfs.io and dweb.link refuse the write API outright and web3.storage answers
   401. So *something* has to hold a key.

   It cannot be the browser. Anything shipped in the bundle is public, and a
   Pinata JWT in a public bundle is an open invitation to burn the account's
   quota. So the key lives here, in a Vercel environment variable, and the launch
   flow asks this function to do the pinning.

   TWO PINATA QUIRKS, BOTH MEASURED RATHER THAN GUESSED

     file + pinataMetadata   -> 200
     pinataContent           -> 400 Unexpected field  (that is pinJSONToIPFS's field)
     pinJSONToIPFS           -> 400  (it wants a JSON content-type; FormData is multipart)

   So the metadata JSON goes up as a FILE named metadata.json, which is also what
   pump.fun's own metadata URIs look like.

   A NOTE ON AUTH, SINCE THERE IS NONE

   This endpoint is deliberately unauthenticated. It has to be reachable before
   the wallet has signed anything — the metadata URI is needed to BUILD the create
   transaction — so gating it behind a signature would mean an extra wallet prompt
   purely to authorise an upload. What that costs is quota: anyone who finds the
   URL can pin through our account. What it cannot cost is money in the fee
   wallet, because nothing here touches chain state or signs anything. The size
   and shape guards below are what keep the exposure bounded.
   ========================================================================== */
var http = require('./_lib/http');
var env = require('./_lib/env');

var PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

/**
 * The gateway baked into the URI that goes on-chain.
 *
 * Not the IPFS content address but the URL written into the coin's account, so it
 * is effectively permanent: pump.fun stores the string and nothing later can
 * rewrite it. `ipfs.io` is what pump.fun's own metadata URIs use, and pump.fun
 * resolves it server-side.
 */
var GATEWAY = 'https://ipfs.io/ipfs/';

/** 2 MB of image. See http.MAX_UPLOAD_BODY for why the ceiling is not higher. */
var MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** pump.fun's own limits. Enforced here so a doomed coin is never pinned. */
var MAX_NAME = 32;
var MAX_SYMBOL = 10;
var MAX_DESCRIPTION = 500;
var MAX_URL = 300;

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** Split a `data:<type>;base64,<payload>` URL into bytes. */
function decodeDataUrl(dataUrl) {
  var m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('image.dataUrl is not a data URL.');
  if (!m[2]) throw new Error('image.dataUrl must be base64 encoded.');
  var buffer = Buffer.from(m[3], 'base64');
  if (!buffer.length) throw new Error('image.dataUrl decoded to zero bytes.');
  return { buffer: buffer, contentType: m[1] || 'application/octet-stream' };
}

async function upload(jwt, form) {
  var r = await fetch(PINATA_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt },
    body: form
  });
  var text = await r.text();
  if (!r.ok) throw new Error('Pinata HTTP ' + r.status + ': ' + text.slice(0, 200));
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Pinata returned a non-JSON body: ' + text.slice(0, 200));
  }
}

module.exports = http.handler(async function (req, res) {
  if (http.methodNotAllowed(req, res, ['GET', 'POST'])) return;

  /* A GET reports whether pinning is configured, and nothing else.
     The launch form needs to know BEFORE someone fills in a name, a ticker and an
     image, because without a credential the flow fails at the very last step and
     the only thing they get for their effort is an error. This is a boolean about
     a server variable: it says a secret exists, never what it is. */
  if (req.method === 'GET') {
    return http.send(res, 200, { ok: true, configured: Boolean(env.pinataJwt()) });
  }

  var jwt = env.pinataJwt();
  if (!jwt) {
    return http.fail(res, 503, 'pinning_not_configured',
      'Pinning is not configured: PINATA_JWT is unset. Set it in the Vercel project settings, then redeploy.');
  }

  var parsed = await http.readJson(req, http.MAX_UPLOAD_BODY);
  if (!parsed.ok) {
    return http.fail(res, 413, 'bad_body',
      parsed.error === 'body too large'
        ? 'That request was too large. Keep the image under 2 MB.'
        : parsed.error);
  }

  var body = parsed.value || {};
  var metadata = body.metadata;
  var image = body.image;

  if (!metadata || typeof metadata !== 'object') {
    return http.fail(res, 400, 'bad_metadata', 'metadata must be an object.');
  }

  var name = clean(metadata.name, MAX_NAME);
  var symbol = clean(metadata.symbol, MAX_SYMBOL);
  if (!name) return http.fail(res, 400, 'bad_name', 'metadata.name is required (max ' + MAX_NAME + ' characters).');
  if (!symbol) return http.fail(res, 400, 'bad_symbol', 'metadata.symbol is required (max ' + MAX_SYMBOL + ' characters).');

  /*
   * Rebuild the JSON from an allowlist rather than forwarding whatever arrived.
   * This function pins a file that becomes permanent on chain, so the shape of it
   * should be decided here and not by the caller — otherwise anything the client
   * sends (including fields pump.fun does not read, or a huge nested object) ends
   * up in the pinned artefact.
   */
  var finalJson = {
    name: name,
    symbol: symbol,
    description: clean(metadata.description, MAX_DESCRIPTION),
    showName: true
  };
  var twitter = clean(metadata.twitter, MAX_URL);
  var website = clean(metadata.website, MAX_URL);
  var createdOn = clean(metadata.createdOn, MAX_URL);
  if (twitter) finalJson.twitter = twitter;
  if (website) finalJson.website = website;
  if (createdOn) finalJson.createdOn = createdOn;

  try {
    /* The image goes first so the metadata can point at the pinned copy. */
    var imageUri = clean(metadata.image, MAX_URL);
    if (image && image.dataUrl) {
      var decoded = decodeDataUrl(image.dataUrl);
      if (decoded.buffer.length > MAX_IMAGE_BYTES) {
        return http.fail(res, 413, 'image_too_large',
          'That image is ' + (decoded.buffer.length / 1048576).toFixed(1) + ' MB. The limit is ' +
          (MAX_IMAGE_BYTES / 1048576) + ' MB.');
      }
      var imgForm = new FormData();
      imgForm.append('file',
        new Blob([decoded.buffer], { type: image.contentType || decoded.contentType }),
        clean(image.filename, 120) || 'image');
      imgForm.append('pinataMetadata', JSON.stringify({ name: name + '-image' }));
      var pinnedImage = await upload(jwt, imgForm);
      imageUri = GATEWAY + pinnedImage.IpfsHash;
    }

    finalJson.image = imageUri;

    var jsonForm = new FormData();
    jsonForm.append('file',
      new Blob([JSON.stringify(finalJson)], { type: 'application/json' }),
      'metadata.json');
    jsonForm.append('pinataMetadata', JSON.stringify({ name: name + '-metadata' }));
    var pinnedJson = await upload(jwt, jsonForm);

    return http.send(res, 200, {
      ok: true,
      uri: GATEWAY + pinnedJson.IpfsHash,
      image: imageUri || null
    });
  } catch (err) {
    /*
     * 502, not 500: the failure is upstream (Pinata), not this function. The
     * message is passed through because "Pinata HTTP 401" tells an operator
     * exactly what to fix and a generic one would not.
     */
    console.error('[pin] failed', err && err.message);
    return http.fail(res, 502, 'pin_failed', String((err && err.message) || err).slice(0, 300));
  }
});
