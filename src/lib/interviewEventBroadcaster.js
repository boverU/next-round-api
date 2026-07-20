/**
 * In-memory SSE broadcaster for interview anti-cheat events.
 * Maps interviewId -> Set of response objects to push new events to.
 *
 * Deliberately in-process: a single API node fans out to the handful of staff
 * watching one interview. If this ever scales to multiple nodes, back it with a
 * pub/sub (Redis) instead of this Map.
 */

const interviewListeners = new Map();

function addInterviewListener(interviewId, res) {
  const id = String(interviewId);
  if (!interviewListeners.has(id)) {
    interviewListeners.set(id, new Set());
  }
  interviewListeners.get(id).add(res);
}

function removeInterviewListener(interviewId, res) {
  const id = String(interviewId);
  const set = interviewListeners.get(id);
  if (set) {
    set.delete(res);
    if (set.size === 0) interviewListeners.delete(id);
  }
}

function notifyInterviewEventListeners(interviewId, event) {
  const id = String(interviewId);
  const set = interviewListeners.get(id);
  if (!set) return;
  const data = JSON.stringify({
    id: event.id,
    event_type: event.event_type,
    actor: event.actor,
    created_at: event.created_at,
  });
  const message = `data: ${data}\n\n`;
  for (const res of set) {
    try {
      res.write(message);
    } catch (err) {
      set.delete(res);
    }
  }
}

module.exports = {
  addInterviewListener,
  removeInterviewListener,
  notifyInterviewEventListeners,
};
