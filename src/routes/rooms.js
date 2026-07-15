const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');
const { mintJitsiJwt } = require('../lib/jitsiJwt');
const config = require('../config');

const router = express.Router();

// Google-Meet-style room code, e.g. "abc-defg-hij". No lookalike chars (l/1/o/0).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz';
function meetCode() {
  const pick = (n) =>
    Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

// An instant room has no plan yet; the snapshot stays empty but present (NOT NULL).
const EMPTY_SNAPSHOT = { role_title: null, questions: [], criteria: [] };

const MOD_FEATURES = { recording: true, transcription: true };

function mintFor(staff, roomName) {
  return mintJitsiJwt({
    roomName,
    user: { id: staff.id, name: staff.name, email: staff.email },
    moderator: true,
    features: MOD_FEATURES,
  });
}

// US: "New meeting" — create an ad-hoc room and enter it as moderator.
router.post('/instant', requireStaff, async (req, res, next) => {
  try {
    let room;
    for (let attempt = 1; ; attempt += 1) {
      const roomName = meetCode();
      try {
        const { rows } = await pool.query(
          `INSERT INTO interview (org_id, created_by, room_name, template_snapshot, status, started_at)
           VALUES ($1, $2, $3, $4, 'live', now())
           RETURNING id, room_name`,
          [req.staff.org_id, req.staff.id, roomName, EMPTY_SNAPSHOT]
        );
        room = rows[0];
        break;
      } catch (err) {
        // 23505 = unique_violation on room_name; try a fresh code a few times.
        if (err.code === '23505' && attempt < 3) continue;
        throw err;
      }
    }

    // The creator is the moderator/owner of their own instant room.
    await pool.query(
      `INSERT INTO interview_panelist (interview_id, user_id, panel_role, is_moderator)
       VALUES ($1, $2, 'lead', true)
       ON CONFLICT (interview_id, user_id) DO NOTHING`,
      [room.id, req.staff.id]
    );

    return res.status(201).json({
      id: room.id,
      roomName: room.room_name,
      jwt: mintFor(req.staff, room.room_name),
      domain: config.JITSI_DOMAIN,
    });
  } catch (err) {
    return next(err);
  }
});

// US: "Join with a code" — a staff member joins an existing room in their org.
router.post('/join', requireStaff, async (req, res, next) => {
  const code = String(req.body?.code ?? '').trim().toLowerCase();
  if (!code) return res.status(400).json({ error: 'Enter a meeting code' });

  try {
    const { rows } = await pool.query(
      `SELECT room_name, status FROM interview
       WHERE room_name = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [code, req.staff.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Meeting not found' });
    if (rows[0].status === 'cancelled' || rows[0].status === 'completed') {
      return res.status(403).json({ error: 'This meeting is closed' });
    }

    return res.json({
      roomName: rows[0].room_name,
      jwt: mintFor(req.staff, rows[0].room_name),
      domain: config.JITSI_DOMAIN,
    });
  } catch (err) {
    return next(err);
  }
});

// PUBLIC (no Clerk): a candidate opens a shared room link in the main app. If
// the room exists and is open, mint a short-lived GUEST token (never moderator,
// no recording). The random room code is the credential — like a Meet link.
// This is how the same-app link joins without the candidate holding a token.
router.post('/guest-token', async (req, res, next) => {
  const code = String(req.body?.code ?? '').trim().toLowerCase();
  if (!code) return res.status(400).json({ error: 'Missing meeting code' });

  try {
    const { rows } = await pool.query(
      `SELECT room_name, status FROM interview
       WHERE room_name = $1 AND deleted_at IS NULL`,
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Meeting not found' });
    if (rows[0].status === 'cancelled' || rows[0].status === 'completed') {
      return res.status(403).json({ error: 'This meeting is closed' });
    }

    const token = mintJitsiJwt({
      roomName: rows[0].room_name,
      user: { id: `guest-${crypto.randomUUID()}`, name: 'Гость' },
      moderator: false,
      features: {},
    });

    return res.json({ roomName: rows[0].room_name, jwt: token, domain: config.JITSI_DOMAIN });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
