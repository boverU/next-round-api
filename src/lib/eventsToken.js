const jwt = require('jsonwebtoken');
const config = require('../config');

// Marks a token minted specifically for the anti-cheat events channel, so a
// Jitsi room token (same secret, same signer) can never be replayed here and
// vice-versa.
const PURPOSE = 'nr-anticheat-events';

// Long enough to outlast an interview. The candidate posts events for the whole
// session; the Jitsi room token's shorter TTL only gates entry, not telemetry.
const TTL_SECONDS = 6 * 60 * 60;

/**
 * Mint a bearer token that authorizes the anti-cheat events channel for one
 * interview. `role` is 'candidate' (may POST events) or 'staff' (may read and
 * stream them). It travels inside the Jitsi JWT's context so the meeting
 * frontend can read it without a second round-trip.
 */
function mintEventsToken({ interviewId, role }) {
  if (!interviewId) throw new Error('mintEventsToken requires an interviewId');
  if (role !== 'candidate' && role !== 'staff') {
    throw new Error(`mintEventsToken role must be candidate|staff, got ${role}`);
  }
  return jwt.sign({ interviewId, role, purpose: PURPOSE }, config.JWT_APP_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
  });
}

/** Verify a token and return { interviewId, role }, or throw. */
function verifyEventsToken(token) {
  const payload = jwt.verify(token, config.JWT_APP_SECRET, { algorithms: ['HS256'] });
  if (payload.purpose !== PURPOSE) throw new Error('Not an events token');
  return payload;
}

/** Pull a Bearer token off the Authorization header, or null. */
function bearerFrom(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

module.exports = { mintEventsToken, verifyEventsToken, bearerFrom, EVENTS_TOKEN_TTL_SECONDS: TTL_SECONDS };
