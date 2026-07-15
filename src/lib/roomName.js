const crypto = require('crypto');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_LEN = 10;

/**
 * Jitsi runs every room name through lowercase + NFKC normalization
 * (getBackendSafeRoomName in jitsi-meet/react/features/base/util/uri.ts).
 * We only emit lowercase ASCII alphanumerics and hyphens, so that transform
 * is the identity function on anything this returns.
 */
function isNormalizationStable(name) {
  return name === name.normalize('NFKC').toLowerCase() && /^[a-z0-9-]+$/.test(name);
}

function slugify(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'role';
}

function randomSuffix() {
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

function generateRoomName(roleTitle) {
  const name = `nr-${slugify(roleTitle)}-${randomSuffix()}`;
  if (!isNormalizationStable(name)) {
    throw new Error(`Generated room name is not normalization-stable: ${name}`);
  }
  return name;
}

module.exports = { generateRoomName, isNormalizationStable, slugify };
