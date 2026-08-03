/* eslint-disable camelcase */

exports.shorthands = undefined;

// Per-interview toggle for the AI-recruiter bot. Default off: a room only gets
// the bot when explicitly opted in. Read by the pull-model launcher via
// GET /api/rooms/ai-pending. Kept on `interview` (not job_role/template_snapshot)
// so it is available at the reservation START handler with no extra join and
// works for instant rooms that have no job_role_id.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview
      ADD COLUMN ai_screening_enabled boolean NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE interview DROP COLUMN ai_screening_enabled;`);
};
