/* ==========================================================================
   CLAIM — api/_lib/solana.js
   Base58 decoding and ed25519 signature verification, using only node:crypto.

   This is what makes POST /api/claim safe without a session, a cookie, or a
   password: the caller proves they control the wallet by signing a message
   only that wallet's private key could produce. A forged `wallet` field is
   useless on its own.
   ========================================================================== */
var crypto = require('crypto');

var B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
var B58_MAP = (function () {
  var m = {};
  for (var i = 0; i < B58_ALPHABET.length; i++) m[B58_ALPHABET[i]] = i;
  return m;
})();

/**
 * Decode a base58 string to bytes. Returns null on any invalid character,
 * rather than throwing — this runs on untrusted input.
 */
function bs58decode(str) {
  if (typeof str !== 'string' || !str.length) return null;

  var bytes = [0];
  for (var i = 0; i < str.length; i++) {
    var val = B58_MAP[str[i]];
    if (val === undefined) return null;

    var carry = val;
    for (var j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Every leading '1' is a leading zero byte.
  for (var k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);

  return Uint8Array.from(bytes.reverse());
}

/**
 * Encode bytes to base58. The mirror of bs58decode, needed to turn a raw 32-byte
 * owner key from an account slice back into an address.
 */
function bs58encode(bytes) {
  if (!bytes || !bytes.length) return '';
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
  // Leading zero bytes are leading '1's.
  for (var k = 0; k < bytes.length && bytes[k] === 0; k++) digits.push(0);
  var out = '';
  for (var m = digits.length - 1; m >= 0; m--) out += B58_ALPHABET[digits[m]];
  return out;
}

/** A Solana address is a base58-encoded 32-byte ed25519 public key. */
function isValidAddress(addr) {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return false;
  var raw = bs58decode(addr);
  return Boolean(raw && raw.length === 32);
}

// DER prefix for an ed25519 SubjectPublicKeyInfo, so node:crypto accepts a raw
// 32-byte key without us hand-rolling an ASN.1 encoder.
var ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify that `signatureBase58` is `message` signed by the private key behind
 * `address`. Returns a boolean; never throws.
 */
function verifySignature(address, message, signatureBase58) {
  try {
    if (!isValidAddress(address)) return false;
    if (typeof message !== 'string' || !message.length) return false;

    var sig = bs58decode(signatureBase58);
    if (!sig || sig.length !== 64) return false;

    var pub = bs58decode(address);
    var key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]),
      format: 'der',
      type: 'spki'
    });

    // For ed25519 the algorithm argument must be null.
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(sig));
  } catch (e) {
    return false;
  }
}

/** Truncate an address for logs, the way the UI does. */
function shortAddress(addr) {
  if (!addr || addr.length < 10) return String(addr || '');
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

module.exports = {
  bs58decode: bs58decode,
  bs58encode: bs58encode,
  isValidAddress: isValidAddress,
  verifySignature: verifySignature,
  shortAddress: shortAddress,
  B58_ALPHABET: B58_ALPHABET
};
