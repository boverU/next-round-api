const crypto = require('crypto');

const PREFIX = 'nrjoin_';
const LOOKUP_LEN = 12;

/** 256 bits of CSPRNG. The `nrjoin_` prefix lets secret scanners catch leaks. */
function generateInviteToken() {
  return PREFIX + crypto.randomBytes(32).toString('base64url');
}

/**
 * The token is 256-bit random, not a low-entropy password, so a fast hash is
 * correct here — bcrypt/argon and salting would buy nothing.
 */
function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest();
}

/**
 * A non-secret prefix of the *hash*, not of the token, so it can safely appear
 * in logs and support tickets. Used to find the row before the constant-time
 * comparison below.
 */
function lookupKey(plaintext) {
  return hashToken(plaintext).toString('hex').slice(0, LOOKUP_LEN);
}

function looksLikeToken(value) {
  return typeof value === 'string' && value.startsWith(PREFIX) && value.length <= 128;
}

/** Constant-time compare so a mismatch leaks no timing information. */
function tokenMatches(plaintext, storedHash) {
  const candidate = hashToken(plaintext);
  const stored = Buffer.isBuffer(storedHash) ? storedHash : Buffer.from(storedHash);
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

module.exports = {
  PREFIX,
  generateInviteToken,
  hashToken,
  lookupKey,
  looksLikeToken,
  tokenMatches,
};
