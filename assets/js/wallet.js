/* ==========================================================================
   ONLYPAD — wallet.js
   Solana wallet connect. Zero dependencies: talks to the injected provider
   (Phantom / Solflare / Backpack) directly, and reads balances over RPC.
   Exposes: window.ONLYPAD.wallet
   ========================================================================== */
(function () {
  "use strict";

  var CFG = {
    /* Same-origin JSON-RPC proxy, not the public endpoint. The public one answers
       HTTP 403 to any request carrying an Origin header, so a browser cannot use it
       at all — this default is what runs if /api/config ever fails, and the old
       value would have failed exactly then. A relative URL is fine here: it is only
       ever handed to fetch(). applyConfig() replaces it with an absolute one. */
    rpc: "/api/rpc",
    cluster: "mainnet-beta",
    // How long to wait for a balance read before giving up.
    rpcTimeout: 6000,
    // The $CLAIM mint. Leave null until the token is deployed — the epoch
    // layer falls back to a clearly-labelled simulated balance while it is null.
    claimMint: null
  };

  var state = {
    provider: null,
    kind: null,
    publicKey: null,
    balance: null,
    connecting: false
  };

  var listeners = {};

  function on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach(function (f) { try { f(payload); } catch (e) { console.error(e); } }); }

  /* ---------- provider discovery ---------- */
  function findProvider() {
    var w = window;
    if (w.phantom && w.phantom.solana && w.phantom.solana.isPhantom) return { p: w.phantom.solana, kind: "Phantom" };
    if (w.solflare && w.solflare.isSolflare) return { p: w.solflare, kind: "Solflare" };
    if (w.backpack && w.backpack.isBackpack) return { p: w.backpack, kind: "Backpack" };
    if (w.solana && (w.solana.isPhantom || w.solana.isSolflare || w.solana.isConnected !== undefined)) {
      return { p: w.solana, kind: w.solana.isPhantom ? "Phantom" : "Solana" };
    }
    return null;
  }

  function short(addr, head, tail) {
    if (!addr) return "";
    head = head || 4; tail = tail || 4;
    return addr.slice(0, head) + "…" + addr.slice(-tail);
  }

  /* ---------- RPC ---------- */
  function getBalance(pubkey) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, CFG.rpcTimeout);
    return fetch(CFG.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pubkey] }),
      signal: ctl ? ctl.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.result && typeof j.result.value === "number") return j.result.value / 1e9;
        throw new Error("bad rpc payload");
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- SPL token balance ---------- */
  /**
   * Read an SPL token balance for `owner`. This is the real on-chain path —
   * it works as soon as CFG.claimMint is set to a deployed mint.
   */
  function getTokenBalance(owner, mint) {
    if (!mint) return Promise.reject(new Error("no mint configured"));
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, CFG.rpcTimeout);
    return fetch(CFG.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint: mint }, { encoding: "jsonParsed" }]
      }),
      signal: ctl ? ctl.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var v = j && j.result && j.result.value;
        if (!v || !v.length) return 0;
        var info = v[0].account && v[0].account.data && v[0].account.data.parsed
          && v[0].account.data.parsed.info;
        var amt = info && info.tokenAmount ? info.tokenAmount.uiAmount : 0;
        return amt || 0;
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- signing ---------- */

  /**
   * Sign a UTF-8 message with the connected wallet. This is what authorises a
   * claim, a launch, or an image upload — the server verifies the signature
   * against the address, so no session or password is needed.
   *
   * Solana providers disagree on how signMessage reports failure: some reject
   * the promise, some resolve with { signature: null }. Both are handled.
   */
  function sign(message) {
    var p = state.provider;
    if (!p || !state.publicKey) {
      return Promise.reject(new Error("Connect a wallet first."));
    }
    if (typeof p.signMessage !== "function") {
      return Promise.reject(new Error("This wallet cannot sign messages. Try Phantom or Solflare."));
    }

    var encoded = typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(message)
      : (function () {
        // Fallback for very old engines; all of ASCII is unchanged.
        var out = [];
        for (var i = 0; i < message.length; i++) out.push(message.charCodeAt(i) & 0xff);
        return new Uint8Array(out);
      })();

    return Promise.resolve(p.signMessage(encoded, "utf8"))
      .then(function (res) {
        // Phantom returns { signature }, Solflare returns a bare Uint8Array.
        var raw = res && res.signature ? res.signature : res;
        if (!raw || !raw.length) throw new Error("The wallet did not return a signature.");
        return base58encode(raw);
      });
  }

  /** Base58-encode the raw signature bytes for transport. */
  function base58encode(bytes) {
    var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) digits.push(0);
    var out = "";
    for (var m = digits.length - 1; m >= 0; m--) out += ALPHABET[digits[m]];
    return out;
  }

  /**
   * Apply runtime configuration fetched from /api/config. Called once on load,
   * so the RPC endpoint and the deployed mint address come from the server
   * environment instead of being committed to the repository.
   */
  function applyConfig(cfg) {
    if (!cfg) return;
    /* The server hands out a same-origin path (`/api/rpc`) rather than the real
       endpoint, so the browser never calls a third-party RPC directly — the
       public Solana endpoint answers 403 to anything with an Origin header.
       web3.js needs a full URL, so resolve it against this page's origin. */
    if (cfg.rpcUrl) CFG.rpc = new URL(cfg.rpcUrl, location.origin).toString();
    if (cfg.cluster) CFG.cluster = cfg.cluster;
    if (cfg.claimMint) CFG.claimMint = cfg.claimMint;
    emit("config", { rpc: CFG.rpc, cluster: CFG.cluster, claimMint: CFG.claimMint });
  }

  /* ---------- connect / disconnect ---------- */
  function connect() {
    if (state.connecting) return Promise.resolve(null);
    state.connecting = true;
    emit("connecting", true);

    var found = findProvider();
    if (!found) {
      state.connecting = false;
      emit("connecting", false);
      emit("error", {
        code: "no_provider",
        message: "No Solana wallet found in this browser.",
        hint: "Install Phantom or Solflare, then reload this page."
      });
      return Promise.resolve(null);
    }

    state.provider = found.p;
    state.kind = found.kind;

    // Some providers are already authorised — skip the prompt.
    var req = (state.provider.publicKey && state.provider.isConnected)
      ? Promise.resolve({ publicKey: state.provider.publicKey })
      : state.provider.connect();

    return Promise.resolve(req)
      .then(function (res) {
        var pk = res && res.publicKey ? res.publicKey.toString() : null;
        if (!pk) throw new Error("Wallet returned no public key.");
        state.publicKey = pk;
        state.connecting = false;
        emit("connecting", false);
        emit("connected", { publicKey: pk, kind: state.kind });
        refreshBalance();
        return pk;
      })
      .catch(function (err) {
        state.connecting = false;
        emit("connecting", false);
        var msg = (err && err.message) || "Connection cancelled.";
        if (/reject|denied|cancel/i.test(msg)) {
          emit("error", { code: "rejected", message: "Connection request was rejected.", hint: "Approve the request in your wallet to continue." });
        } else {
          emit("error", { code: "failed", message: msg, hint: "" });
        }
        return null;
      });
  }

  function disconnect() {
    var p = state.provider;
    state.publicKey = null;
    state.balance = null;
    emit("disconnected", {});
    if (p && typeof p.disconnect === "function") {
      try { p.disconnect(); } catch (e) { /* ignore */ }
    }
  }

  function refreshBalance() {
    if (!state.publicKey) return Promise.resolve(null);
    return getBalance(state.publicKey)
      .then(function (sol) { state.balance = sol; emit("balance", sol); return sol; })
      .catch(function () { state.balance = null; emit("balance", null); return null; });
  }

  /* ---------- wire provider events ---------- */
  function bindProviderEvents() {
    var found = findProvider();
    if (!found) return;
    var p = found.p;
    state.provider = p;
    state.kind = found.kind;

    if (typeof p.on === "function") {
      p.on("accountChanged", function (pk) {
        if (pk) {
          state.publicKey = pk.toString();
          emit("connected", { publicKey: state.publicKey, kind: state.kind });
          refreshBalance();
        } else {
          disconnect();
        }
      });
      p.on("disconnect", function () { disconnect(); });
    }

    // Re-attach silently if the page loads with an already-authorised wallet.
    if (p.publicKey && p.isConnected) {
      state.publicKey = p.publicKey.toString();
      emit("connected", { publicKey: state.publicKey, kind: state.kind, silent: true });
      refreshBalance();
    }
  }

  window.ONLYPAD = window.ONLYPAD || {};
  window.ONLYPAD.wallet = {
    cfg: CFG,
    state: state,
    on: on,
    connect: connect,
    disconnect: disconnect,
    refreshBalance: refreshBalance,
    getTokenBalance: getTokenBalance,
    sign: sign,
    applyConfig: applyConfig,
    short: short,
    address: function () { return state.publicKey; },
    connected: function () { return Boolean(state.publicKey); },
    available: function () { return !!findProvider(); },
    init: function () {
      bindProviderEvents();
      // Providers inject after page load in some browsers.
      window.addEventListener("load", function () { setTimeout(bindProviderEvents, 350); });
    }
  };

  window.ONLYPAD.wallet.init();
})();
