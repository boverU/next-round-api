const express = require('express');
const { pool } = require('../db/pool');
const config = require('../config');

const router = express.Router();

/**
 * Prosody's mod_reservations calls this before it will let a room exist.
 * Contract (jitsi-meet/resources/prosody-plugins/mod_reservations.lua):
 *
 *   POST   <prefix>/conference       form-encoded: name, start_time, mail_owner
 *          -> 200/201 JSON { id, name, mail_owner, duration, start_time }
 *          -> 409 JSON { conflict_id }
 *          -> anything else: JSON { message }, and the room is refused
 *   GET    <prefix>/conference/:id   -> the same JSON payload
 *   DELETE <prefix>/conference/:id   -> room went empty
 *
 * `name` in the response must equal the requested room name lowercased, and
 * `duration` is in seconds.
 */

// Prosody has no way to present a Clerk session, so the shared secret (set as a
// custom header via reservations_api_headers) is what authenticates it.
function requireReservationSecret(req, res, next) {
  if (!config.RESERVATION_SHARED_SECRET) return next();
  if (req.get('x-nextround-reservation-secret') === config.RESERVATION_SHARED_SECRET) return next();
  return res.status(403).json({ message: 'Forbidden' });
}

function toPayload(row) {
  return {
    id: row.id,
    name: row.room_name,
    mail_owner: row.owner_email,
    duration: row.duration_minutes * 60,
    start_time: new Date(row.scheduled_at ?? row.created_at).toISOString(),
  };
}

const SELECT_BY = (where) => `
  SELECT i.id, i.room_name, i.status, i.scheduled_at, i.created_at, i.duration_minutes,
         u.email AS owner_email
  FROM interview i
  JOIN app_user u ON u.id = i.created_by
  WHERE ${where} AND i.deleted_at IS NULL`;

router.post('/conference', requireReservationSecret, async (req, res, next) => {
  const name = (req.body?.name ?? '').toLowerCase();
  if (!name) return res.status(400).json({ message: 'Missing room name' });

  try {
    const { rows } = await pool.query(SELECT_BY('i.room_name = $1'), [name]);

    // An unknown room simply cannot exist, regardless of how valid the JWT is.
    if (rows.length === 0) {
      return res.status(403).json({ message: 'No interview is scheduled for this room' });
    }
    const interview = rows[0];
    if (interview.status === 'cancelled' || interview.status === 'completed') {
      return res.status(403).json({ message: 'This interview is no longer open' });
    }

    await pool.query(
      `UPDATE interview
       SET status = CASE WHEN status = 'scheduled' THEN 'live' ELSE status END,
           started_at = COALESCE(started_at, now()),
           updated_at = now()
       WHERE id = $1`,
      [interview.id]
    );

    return res.status(200).json(toPayload(interview));
  } catch (err) {
    return next(err);
  }
});

router.get('/conference/:id', requireReservationSecret, async (req, res, next) => {
  try {
    const { rows } = await pool.query(SELECT_BY('i.id = $1'), [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    return res.json(toPayload(rows[0]));
  } catch (err) {
    return next(err);
  }
});

// Fired when the room empties. Not load-bearing for US-1, but it is what keeps
// the dashboard's Live/Completed state honest.
router.delete('/conference/:id', requireReservationSecret, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE interview
       SET status = CASE WHEN status = 'live' THEN 'awaiting_decision' ELSE status END,
           ended_at = COALESCE(ended_at, now()),
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
