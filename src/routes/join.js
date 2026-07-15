const path = require('path');
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/pool');
const { resolveInvite, REASON_STATUS, REASON_MESSAGE } = require('../services/resolveInvite');
const { mintJitsiJwt } = require('../lib/jitsiJwt');
const config = require('../config');

const publicRouter = express.Router(); // GET /join/:token  — the lobby page
const apiRouter = express.Router(); // /api/join/:token — context + join

function errorPage(res, reason) {
  const status = REASON_STATUS[reason] ?? 400;
  return res.status(status).type('html').send(
    `<!doctype html><meta charset="utf-8"><title>Invite unavailable — NextRound</title>
     <body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem">
       <h1>Invite unavailable</h1><p>${REASON_MESSAGE[reason]}</p>
       <p>Ask your recruiter for a fresh link.</p>
     </body>`
  );
}

// The candidate has no account: the link itself is the credential (NFR-2).
publicRouter.get('/:token', async (req, res, next) => {
  try {
    const result = await resolveInvite(req.params.token);
    if (!result.ok) return errorPage(res, result.reason);
    return res.sendFile(path.join(__dirname, '..', '..', 'public', 'join.html'));
  } catch (err) {
    return next(err);
  }
});

// What the lobby screen needs to render. Anyone holding the token may read it.
apiRouter.get('/:token', async (req, res, next) => {
  try {
    const result = await resolveInvite(req.params.token);
    if (!result.ok) {
      return res.status(REASON_STATUS[result.reason]).json({ error: REASON_MESSAGE[result.reason] });
    }
    const { invite } = result;
    return res.json({
      candidateName: invite.candidate_name,
      roleTitle: invite.role_title,
      scheduledAt: invite.scheduled_at,
      questionCount: invite.template_snapshot.questions.length,
      alreadyConsented: Boolean(invite.candidate_consented_at),
    });
  } catch (err) {
    return next(err);
  }
});

const joinSchema = z.object({ consent: z.literal(true) });

/**
 * Record consent (NFR-5) and mint the token Jitsi actually checks.
 *
 * The invite is a NextRound credential, revocable in our database. What we hand
 * the browser is a *derived* credential: scoped to one room, valid for minutes,
 * never a moderator, never allowed to record. Revoking the invite stops new
 * mints immediately; the short expiry caps the damage of a leaked one.
 */
apiRouter.post('/:token', async (req, res, next) => {
  const parsed = joinSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Consent is required to join' });

  try {
    const result = await resolveInvite(req.params.token);
    if (!result.ok) {
      return res.status(REASON_STATUS[result.reason]).json({ error: REASON_MESSAGE[result.reason] });
    }
    const { invite } = result;

    // Guard max_uses against a race between two concurrent joins.
    const { rowCount } = await pool.query(
      `UPDATE invite_token
       SET use_count = use_count + 1, last_used_at = now()
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
         AND (max_uses IS NULL OR use_count < max_uses)`,
      [invite.id]
    );
    if (rowCount === 0) return res.status(403).json({ error: REASON_MESSAGE.exhausted });

    await pool.query(
      `UPDATE interview
       SET candidate_consented_at = COALESCE(candidate_consented_at, now()), updated_at = now()
       WHERE id = $1`,
      [invite.interview_id]
    );

    const token = mintJitsiJwt({
      roomName: invite.room_name,
      user: {
        // Instant rooms may have no candidate on file yet; fall back to a guest.
        id: invite.candidate_id ?? `guest-${invite.id}`,
        name: invite.candidate_name ?? 'Candidate',
        email: invite.candidate_email ?? undefined,
      },
      moderator: false,
      features: {}, // candidates can never record, stream, or transcribe
    });

    return res.json({ domain: config.JITSI_DOMAIN, roomName: invite.room_name, jwt: token });
  } catch (err) {
    return next(err);
  }
});

module.exports = { publicRouter, apiRouter };
