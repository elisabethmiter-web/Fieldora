"use strict";
// Time-based one-time passwords (RFC 6238), compatible with Google Authenticator,
// Microsoft Authenticator, Authy, 1Password, etc.
const crypto = require("crypto");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => base32Encode(crypto.randomBytes(20));

function codeAt(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
const currentStep = () => Math.floor(Date.now() / 30000);

// Returns the matching time step, or null. Allows one step of clock drift either way
// and refuses any step at or before lastStep (so a code can't be reused).
function verify(secret, code, lastStep = 0) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = currentStep();
  for (const s of [now - 1, now, now + 1]) {
    if (s <= lastStep) continue;
    const expected = Buffer.from(codeAt(secret, s)), given = Buffer.from(c);
    if (crypto.timingSafeEqual(expected, given)) return s;
  }
  return null;
}
function otpauthUrl(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
module.exports = { newSecret, verify, otpauthUrl, codeAt, currentStep };
