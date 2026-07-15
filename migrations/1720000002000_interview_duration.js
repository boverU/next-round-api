/* eslint-disable camelcase */

exports.shorthands = undefined;

// Prosody's mod_reservations requires a numeric `duration` (seconds) in the
// POST /conference response, and the demo dashboard already shows "45 minutes".
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview
      ADD COLUMN duration_minutes int NOT NULL DEFAULT 45
        CHECK (duration_minutes BETWEEN 5 AND 480);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE interview DROP COLUMN duration_minutes;`);
};
