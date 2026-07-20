const crypto = require('crypto');

/**
 * In-memory store for anti-cheat events (MVP — nothing is persisted).
 * Maps interviewId -> array of events, oldest first.
 *
 * Trade-offs to be aware of:
 *   - Events vanish on process restart. Fine while an interview is live; not a
 *     durable audit record. Move back to Postgres (see git history for the
 *     interview_event table) when you need events to survive a deploy.
 *   - Single-process only, same as the SSE broadcaster it feeds.
 *   - Capped per interview so a long or hostile session can't grow unbounded.
 */

const MAX_PER_INTERVIEW = 500;

const events = new Map();

/** Append an event and return the stored record ({ id, event_type, actor, created_at }). */
function addEvent(interviewId, { event_type: eventType, actor = 'candidate' }) {
  const key = String(interviewId);
  const event = {
    id: crypto.randomUUID(),
    event_type: eventType,
    actor,
    created_at: new Date().toISOString(),
  };

  let list = events.get(key);
  if (!list) {
    list = [];
    events.set(key, list);
  }
  list.push(event);

  // Keep only the most recent MAX_PER_INTERVIEW.
  if (list.length > MAX_PER_INTERVIEW) {
    list.splice(0, list.length - MAX_PER_INTERVIEW);
  }

  return event;
}

/** Most recent events for an interview, newest first. */
function listEvents(interviewId, limit = 50) {
  const list = events.get(String(interviewId)) || [];
  return list.slice(-limit).reverse();
}

module.exports = { addEvent, listEvents };
