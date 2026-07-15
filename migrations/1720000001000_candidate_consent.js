/* eslint-disable camelcase */

exports.shorthands = undefined;

// NFR-5 requires explicit candidate consent before recording. The consent is
// given on the lobby screen, at the moment the candidate clicks Join, so it is
// a property of the interview rather than of the invite.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview
      ADD COLUMN candidate_consented_at timestamptz;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview DROP COLUMN candidate_consented_at;
  `);
};
