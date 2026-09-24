/* ==========================================================================
   OnlyPad — wallet.
   Tries a real Solana provider if one is actually installed, and falls back to
   a simulated session when it is not. Which one happened is reported honestly
   in the UI: `real` is true only if a provider returned a genuine public key.
   ========================================================================== */
(function (root) {
  'use strict';

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function randAddr() {
    var s = '';
    for (var i = 0; i < 44; i++) s += B58[Math.floor(Math.random() * B58.length)];
    return s;
  }

  /* deterministic from the address, so a session's numbers do not jump around */
  function hash(a) {
    var n = 2166136261;
    for (var i = 0; i < a.length; i++) { n ^= a.charCodeAt(i); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }

  var state = { connected: false, address: null, real: false };

  function provider() {
    if (root.phantom && root.phantom.solana) return root.phantom.solana;
    if (root.solana && root.solana.isPhantom) return root.solana;
    if (root.solflare && root.solflare.isSolflare) return root.solflare;
    return null;
  }

  function derive(a) {
    var n = hash(a);
    return {
      /* some wallets land under MIN_HOLD on purpose, so the floor is visible */
      balance: (n % 9 === 0) ? 40 + (n % 55) : 140 + (n % 42000),
      days: 1 + (n % 400),
      neverSold: (n % 5) === 0
    };
  }

  root.ONLYPAD = root.ONLYPAD || {};
  root.ONLYPAD.wallet = {
    get connected() { return state.connected; },
    get address() { return state.address; },
    get real() { return state.real; },
    get position() {
      if (!state.address) return null;
      var d = derive(state.address);
      return {
        address: state.address,
        balance: d.balance,
        days: d.days,
        neverSold: d.neverSold,
        real: state.real
      };
    },

    /* Returns the address, or null if the user rejected the prompt. */
    connect: function () {
      var p = provider();
      if (p && typeof p.connect === 'function') {
        /* A real provider exists. Try it — but do not pretend it worked. */
        try {
          var res = p.connect();
          if (res && typeof res.then === 'function') {
            res.then(function (r) {
              var pk = (r && r.publicKey) ? r.publicKey.toString() : null;
              if (pk) {
                state.connected = true; state.address = pk; state.real = true;
                if (root.ONLYPAD.app) root.ONLYPAD.app.toast('ok', 'Wallet connected', pk.slice(0, 4) + '…' + pk.slice(-4));
                if (root.ONLYPAD.syncWalletLabel) root.ONLYPAD.syncWalletLabel();
                if (root.ONLYPAD.gate) root.ONLYPAD.gate();
                if (root.ONLYPAD.onWallet) root.ONLYPAD.onWallet();
              }
            }).catch(function () {
              if (root.ONLYPAD.app) {
                root.ONLYPAD.app.toast('warn', 'Wallet declined',
                  'Falling back to a simulated session. No real wallet is being used.');
              }
              simulate();
            });
          } else {
            var pk2 = (res && res.publicKey) ? res.publicKey.toString() : null;
            if (pk2) { state.connected = true; state.address = pk2; state.real = true; }
            else simulate();
          }
        } catch (e) {
          simulate();
        }
        /* If the promise is still pending we return the placeholder below and
           the then() above will refresh the UI when it settles. */
        return state.address || 'Connecting…';
      }
      return simulate();
    },

    disconnect: function () {
      var p = provider();
      if (p && state.real && typeof p.disconnect === 'function') {
        try { p.disconnect(); } catch (e) { /* nothing to do */ }
      }
      state.connected = false; state.address = null; state.real = false;
    }
  };

  function simulate() {
    state.connected = true;
    state.address = randAddr();
    state.real = false;
    if (root.ONLYPAD.app) {
      root.ONLYPAD.app.toast('info', 'Simulated wallet connected',
        'No Solana provider was found, so this address is generated for display only. ' +
        'Nothing on this page is signed or sent to chain.');
    }
    return state.address;
  }
}(window));
