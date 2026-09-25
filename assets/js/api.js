/* ==========================================================================
   ONLYPAD — api.js
   Browser client for the /api/* functions.

   Design rule: this NEVER throws and never rejects. Every method resolves to
   an object with an `ok` flag. The site must render identically whether it is
   deployed on Vercel, served from a local static server, or opened straight
   off disk as file:// — in the last two cases there is no API, and the data
   layer falls back to the demo dataset.

   Exposes: window.ONLYPAD.api
   ========================================================================== */
(function () {
  "use strict";

  var CFG = {
    BASE: null,        // override with an absolute URL to point at a different deployment
    TIMEOUT: 6000
  };

  /**
   * Where the API lives. Same-origin when the page is served over http(s),
   * null when it is not — a file:// page has no origin to call, and attempting
   * it would produce a confusing CORS error in the console.
   */
  function base() {
    if (CFG.BASE !== null) return CFG.BASE;
    if (typeof location === "undefined" || !location.protocol) return null;
    if (location.protocol !== "http:" && location.protocol !== "https:") return null;
    return "";
  }

  function available() {
    return typeof fetch === "function" && base() !== null;
  }

  function reason() {
    if (typeof fetch !== "function") return "fetch is unavailable in this browser";
    if (base() === null) return "opened from file:// — no API origin to call";
    return "the API is unavailable";
  }

  function timeout(ms) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var id = setTimeout(function () { if (ctl) ctl.abort(); }, ms || CFG.TIMEOUT);
    return {
      signal: ctl ? ctl.signal : undefined,
      clear: function () { clearTimeout(id); }
    };
  }

  function get(path, params) {
    if (!available()) return Promise.resolve({ ok: false, source: "offline", reason: reason() });

    var url = base() + path;
    var qs = [];
    for (var k in params || {}) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === "") continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
    if (qs.length) url += "?" + qs.join("&");

    var t = timeout();
    return fetch(url, { headers: { Accept: "application/json" }, signal: t.signal })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (body) {
        t.clear();
        if (!body) return { ok: false, source: "error", reason: "the API returned an unreadable response" };
        return body;
      })
      .catch(function (e) {
        t.clear();
        var why = e && e.name === "AbortError" ? "the API timed out" : "could not reach the API";
        return { ok: false, source: "offline", reason: why };
      });
  }

  function post(path, body, timeoutMs) {
    if (!available()) return Promise.resolve({ ok: false, source: "offline", reason: reason() });

    // Uploads and settles can take a moment; the launch record also has to wait
    // on an RPC read and a pump.fun index lookup, so it asks for longer.
    var t = timeout(timeoutMs || 20000);
    return fetch(base() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: t.signal
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (parsed) {
          t.clear();
          if (!parsed) return { ok: false, source: "error", reason: "the API returned an unreadable response", status: r.status };
          if (!r.ok) {
            return {
              ok: false,
              status: r.status,
              source: "error",
              code: parsed.error && parsed.error.code,
              reason: (parsed.error && parsed.error.message) || ("HTTP " + r.status)
            };
          }
          return parsed;
        });
      })
      .catch(function (e) {
        t.clear();
        var why = e && e.name === "AbortError" ? "the request timed out" : "could not reach the API";
        return { ok: false, source: "offline", reason: why };
      });
  }

  /* ================= endpoints ================= */

  function health() { return get("/api/health"); }
  function config() { return get("/api/config"); }
  function feed(opts) { return get("/api/feed", opts); }
  function coins(opts) { return get("/api/coins", opts); }
  function coin(mint) { return get("/api/coin", { mint: mint }); }
  function pinStatus() { return get("/api/pin"); }

  /* ================= signed writes =================
     These need a wallet that can signMessage. wallet.js exposes sign().
     The message is built by the SHARED claim-message module so the browser and
     the server agree byte for byte — a mismatch here fails every claim. */

  function signer() {
    var w = window.ONLYPAD && window.ONLYPAD.wallet;
    if (!w || typeof w.address !== "function" || !w.address()) {
      return { ok: false, reason: "Connect a wallet first." };
    }
    if (typeof w.sign !== "function") return { ok: false, reason: "This wallet cannot sign messages. Try Phantom or Solflare." };
    return { ok: true, wallet: w };
  }

  function signedPost(path, build, extra) {
    var s = signer();
    if (!s.ok) return Promise.resolve({ ok: false, source: "offline", reason: s.reason });

    var address = s.wallet.address();
    var issued = Math.floor(Date.now() / 1000);
    var nonce = window.ONLYPAD.claimMessage.makeNonce();
    var message = build(address, issued, nonce);
    var payload = Object.assign({ wallet: address, issued: issued, nonce: nonce, message: message }, extra || {});

    return s.wallet.sign(message).then(function (signature) {
      if (!signature) return { ok: false, source: "error", reason: "The wallet did not return a signature." };
      payload.signature = signature;
      return post(path, payload);
    }).catch(function (e) {
      return { ok: false, source: "error", reason: (e && e.message) || "Signing was cancelled." };
    });
  }

  /**
   * Record a coin that has ALREADY been created on chain.
   *
   * Deliberately not signature-gated, and that is not an oversight. By the time
   * this runs the user has already approved one or two transactions, and a third
   * prompt purely to authorise a database row buys nothing — the server verifies
   * the coin against the pump.fun index instead, which is strictly stronger: it
   * proves the coin exists AND that its creator fees route to this launchpad.
   * See api/launch.js.
   */
  function recordLaunch(details) {
    return post("/api/launch", details, 45000);
  }

  /*
   * There is no upload() here any more.
   *
   * POST /api/upload pinned an image behind a wallet signature, which the launch
   * flow cannot use: the metadata URI has to exist BEFORE the create transaction
   * is built, so there is nothing to sign yet. POST /api/pin does the same job
   * without the signature, and the wizard goes through the launch bundle to it.
   *
   * It was removed rather than kept "just in case" because Vercel's Hobby plan
   * allows at most 12 serverless functions per deployment, and this was the
   * thirteenth — a dead endpoint that would have cost the deploy.
   */

  window.ONLYPAD = window.ONLYPAD || {};
  window.ONLYPAD.api = {
    CFG: CFG,
    base: base,
    available: available,
    reason: reason,
    health: health,
    config: config,
    feed: feed,
    coins: coins,
    coin: coin,
    pinStatus: pinStatus,
    recordLaunch: recordLaunch,
    launch: recordLaunch
  };
})();
