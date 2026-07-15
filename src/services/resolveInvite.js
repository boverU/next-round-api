const { pool } = require('../db/pool');
const { looksLikeToken, lookupKey, tokenMatches } = require('../lib/tokens');

/**
 * Look up an invite by the non-secret hash prefix, then confirm with a
 * constant-time comparison of the full hash. Returns { ok: false, reason } for
 * every rejection so callers never have to guess why.
 */
async function resolveInvite(plaintext) {
  if (!looksLikeToken(plaintext)) return { ok: false, reason: 'not_found' };

  const { rows } = await pool.query(
    `SELECT t.id, t.token_hash, t.expires_at, t.revoked_at, t.max_uses, t.use_count,
            i.id AS interview_id, i.room_name, i.status, i.scheduled_at,
            i.candidate_consented_at,
            c.id AS candidate_id, c.full_name AS candidate_name, c.email AS candidate_email,
            r.title AS role_title,
            i.template_snapshot
     FROM invite_token t
     JOIN interview i ON i.id = t.interview_id
     LEFT JOIN candidate c ON c.id = i.candidate_id
     LEFT JOIN job_role  r ON r.id = i.job_role_id
     WHERE t.token_lookup = $1 AND i.deleted_at IS NULL`,
    [lookupKey(plaintext)]
  );

  if (rows.length === 0) return { ok: false, reason: 'not_found' };
  const invite = rows[0];

  if (!tokenMatches(plaintext, invite.token_hash)) return { ok: false, reason: 'not_found' };
  if (invite.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(invite.expires_at) <= new Date()) return { ok: false, reason: 'expired' };
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return { ok: false, reason: 'exhausted' };
  }
  if (invite.status === 'cancelled' || invite.status === 'completed') {
    return { ok: false, reason: 'closed' };
  }

  return { ok: true, invite };
}

const REASON_STATUS = {
  not_found: 404,
  revoked: 403,
  expired: 410,
  exhausted: 403,
  closed: 410,
};

const REASON_MESSAGE = {
  not_found: 'This invite link is not valid.',
  revoked: 'This invite link has been revoked.',
  expired: 'This invite link has expired.',
  exhausted: 'This invite link has already been used.',
  closed: 'This interview is no longer open.',
};

module.exports = { resolveInvite, REASON_STATUS, REASON_MESSAGE };
