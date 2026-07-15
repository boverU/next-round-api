const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');
const { generateInviteToken, hashToken, lookupKey } = require('../lib/tokens');
const config = require('../config');

const router = express.Router();

const inviteSchema = z.object({
  maxUses: z.number().int().positive().nullish(),
});

/**
 * Mint a candidate invite. The plaintext is returned exactly once, here — only
 * its sha256 is stored, so a database leak yields no usable links.
 */
router.post('/:id/invite', requireStaff, async (req, res, next) => {
  const parsed = inviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  try {
    const { rows: interviewRows } = await pool.query(
      `SELECT id, scheduled_at FROM interview
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
         AND status NOT IN ('cancelled','completed')`,
      [req.params.id, req.staff.org_id]
    );
    if (interviewRows.length === 0) return res.status(404).json({ error: 'Interview not found' });

    const base = interviewRows[0].scheduled_at ?? new Date();
    const expiresAt = new Date(new Date(base).getTime() + config.INVITE_TTL_HOURS * 3600 * 1000);

    const plaintext = generateInviteToken();
    const { rows } = await pool.query(
      `INSERT INTO invite_token
         (interview_id, token_hash, token_lookup, expires_at, max_uses, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [
        req.params.id,
        hashToken(plaintext),
        lookupKey(plaintext),
        expiresAt,
        parsed.data.maxUses ?? null,
        req.staff.id,
      ]
    );

    return res.status(201).json({
      inviteId: rows[0].id,
      expiresAt: rows[0].expires_at,
      joinUrl: `${config.PUBLIC_BASE_URL}/join/${plaintext}`,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/invite/:inviteId/revoke', requireStaff, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE invite_token t
       SET revoked_at = now()
       FROM interview i
       WHERE t.id = $1 AND t.interview_id = $2 AND i.id = t.interview_id
         AND i.org_id = $3 AND t.revoked_at IS NULL`,
      [req.params.inviteId, req.params.id, req.staff.org_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Invite not found' });
    return res.json({ revoked: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
