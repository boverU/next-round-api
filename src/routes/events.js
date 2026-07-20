const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');
const { verifyEventsToken, bearerFrom } = require('../lib/eventsToken');
const {
  addInterviewListener,
  removeInterviewListener,
  notifyInterviewEventListeners,
} = require('../lib/interviewEventBroadcaster');
const { addEvent, listEvents } = require('../lib/interviewEventStore');

const router = express.Router();

// Cap event_type so a hostile candidate frame can't flood memory with a
// megabyte string. The real signals ("tab_hidden", "Candidate clicked: Paste")
// are short.
const eventSchema = z.object({
  event_type: z.string().trim().min(1).max(200),
});

/**
 * Authorize via an anti-cheat events token pinned to :id with the required
 * role. Returns the decoded payload, or null (never throws) so callers can fall
 * back to another auth path.
 */
function eventsTokenAuth(req, requiredRole) {
  const token = bearerFrom(req);
  if (!token) return null;
  try {
    const payload = verifyEventsToken(token);
    if (payload.interviewId !== req.params.id) return null;
    if (requiredRole && payload.role !== requiredRole) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

/**
 * POST /api/interviews/:id/events
 * The unauthorized candidate reports one anti-cheat event. Authorized only by
 * the events token embedded in their Jitsi JWT context — never Clerk.
 */
router.post('/:id/events', (req, res) => {
  const auth = eventsTokenAuth(req, 'candidate');
  if (!auth) return res.status(403).json({ error: 'Invalid or missing events token' });

  const parsed = eventSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid or missing event_type' });

  // The events token is signed by us and pinned to this interview, so it is
  // itself proof the interview is real — no DB lookup needed to store the event.
  const event = addEvent(req.params.id, { event_type: parsed.data.event_type, actor: 'candidate' });

  notifyInterviewEventListeners(req.params.id, event);

  return res.status(201).json({ event });
});

/**
 * A viewer is either staff holding a role:'staff' events token (the interviewer
 * inside the Jitsi call) or a Clerk-authenticated staff member whose org owns
 * the interview (a dashboard). Sets req.viewer and calls next(), or responds.
 */
async function requireViewer(req, res, next) {
  if (eventsTokenAuth(req, 'staff')) {
    req.viewer = { via: 'events-token' };
    return next();
  }
  // Fall back to Clerk, then confirm the interview belongs to the caller's org.
  return requireStaff(req, res, async (err) => {
    if (err) return next(err);
    try {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM interview WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [req.params.id, req.staff.org_id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Interview not found' });
      req.viewer = { via: 'clerk' };
      return next();
    } catch (e) {
      return next(e);
    }
  });
}

/**
 * GET /api/interviews/:id/events
 * Recent events, newest first. Staff only.
 */
router.get('/:id/events', requireViewer, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  return res.json({ events: listEvents(req.params.id, limit) });
});

/**
 * GET /api/interviews/:id/events/stream
 * SSE stream of new events. Staff only.
 */
router.get('/:id/events/stream', requireViewer, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Open the stream and defeat idle-timeout proxies with a comment ping.
  res.write(': connected\n\n');
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_err) {
      /* the close handler will clean up */
    }
  }, 25000);

  addInterviewListener(req.params.id, res);

  req.on('close', () => {
    clearInterval(keepAlive);
    removeInterviewListener(req.params.id, res);
  });
});

module.exports = router;
