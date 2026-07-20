const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');
const { createInterview } = require('../services/createInterview');
const { mintJitsiJwt } = require('../lib/jitsiJwt');
const { mintEventsToken } = require('../lib/eventsToken');
const config = require('../config');

const router = express.Router();

const createSchema = z.object({
  jobRoleId: z.string().uuid(),
  candidateId: z.string().uuid(),
  scheduledAt: z.coerce.date().nullish(),
  panelistUserIds: z.array(z.string().uuid()).default([]),
});

// US-1: create an interview room for a role.
router.post('/', requireStaff, async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors });
  }

  try {
    const interview = await createInterview({
      orgId: req.staff.org_id,
      createdBy: req.staff.id,
      jobRoleId: parsed.data.jobRoleId,
      candidateId: parsed.data.candidateId,
      scheduledAt: parsed.data.scheduledAt ?? null,
      panelistUserIds: parsed.data.panelistUserIds,
    });
    return res.status(201).json({ interview });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// US-13: the dashboard list.
router.get('/', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.room_name, i.status, i.scheduled_at,
              c.full_name AS candidate_name, c.headline AS candidate_headline,
              r.title AS role_title,
              u.name AS created_by_name
       FROM interview i
       JOIN candidate c ON c.id = i.candidate_id
       JOIN job_role  r ON r.id = i.job_role_id
       JOIN app_user  u ON u.id = i.created_by
       WHERE i.org_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.scheduled_at DESC NULLS LAST, i.created_at DESC
       LIMIT 100`,
      [req.staff.org_id]
    );
    res.json({ interviews: rows });
  } catch (err) {
    next(err);
  }
});

// Staff join the same room, but as moderator when the panel says so.
router.post('/:id/join', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.room_name, p.is_moderator
       FROM interview i
       JOIN interview_panelist p ON p.interview_id = i.id AND p.user_id = $2
       WHERE i.id = $1 AND i.org_id = $3 AND i.deleted_at IS NULL
         AND i.status NOT IN ('cancelled','completed')`,
      [req.params.id, req.staff.id, req.staff.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Interview not found' });

    const { room_name: roomName, is_moderator: isModerator } = rows[0];
    const token = mintJitsiJwt({
      roomName,
      user: { id: req.staff.id, name: req.staff.name, email: req.staff.email },
      moderator: isModerator,
      features: { recording: isModerator, transcription: isModerator },
      // A staff-scoped token lets the interviewer watch the candidate's events
      // live from inside the call, without a separate Clerk round-trip.
      nextround: {
        interviewId: req.params.id,
        role: 'staff',
        apiBase: config.PUBLIC_BASE_URL,
        eventsToken: mintEventsToken({ interviewId: req.params.id, role: 'staff' }),
      },
    });

    return res.json({ domain: config.JITSI_DOMAIN, roomName, jwt: token });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
