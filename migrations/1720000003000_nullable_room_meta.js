/* eslint-disable camelcase */

exports.shorthands = undefined;

// Google-Meet-style "instant meetings" create a room before a role or candidate
// is chosen, so those two columns must be optional. Structured interviews still
// set them; the create-interview service is unchanged.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview ALTER COLUMN job_role_id  DROP NOT NULL;
    ALTER TABLE interview ALTER COLUMN candidate_id DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE interview ALTER COLUMN job_role_id  SET NOT NULL;
    ALTER TABLE interview ALTER COLUMN candidate_id SET NOT NULL;
  `);
};
