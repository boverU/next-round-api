const jwt = require('jsonwebtoken');
const config = require('../config');

const NO_FEATURES = {
  recording: false,
  livestreaming: false,
  transcription: false,
  'outbound-call': false,
};

/**
 * Mint a short-lived, room-scoped Jitsi token.
 *
 * The `room` claim pins the token to exactly one conference, so a leaked token
 * cannot roam. Prosody verifies the HS256 signature against JWT_APP_SECRET.
 */
function mintJitsiJwt({ roomName, user, moderator = false, features = {}, nextround, lobbyBypass = false }) {
  if (!roomName) throw new Error('mintJitsiJwt requires a roomName');

  const payload = {
    iss: config.JWT_APP_ID,
    aud: config.jitsiAudience,
    sub: config.JITSI_XMPP_DOMAIN,
    room: roomName,
    context: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email ?? undefined,
        moderator: Boolean(moderator),
        // Read by Prosody's mod_token_lobby_bypass: grants member affiliation
        // BEFORE the lobby gate, so the recorder joins a lobby-protected room.
        // (moderator alone won't do it — token_affiliation skips when lobby is on.)
        ...(lobbyBypass ? { lobby_bypass: true } : {}),
      },
      features: { ...NO_FEATURES, ...features },
      // App-specific sidecar Prosody ignores. Lets the meeting frontend know it
      // is inside a NextRound interview, who it is, and where to send anti-cheat
      // telemetry — all without a second call back to us.
      ...(nextround ? { nextround } : {}),
    },
  };

  return jwt.sign(payload, config.JWT_APP_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JITSI_JWT_TTL_SECONDS,
  });
}

module.exports = { mintJitsiJwt, NO_FEATURES };
