const { withTransaction } = require('../db/pool');
const { generateRoomName } = require('../lib/roomName');

const UNIQUE_VIOLATION = '23505';
const ROOM_NAME_ATTEMPTS = 3;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Create an interview and FREEZE the role's question plan and scoring criteria
 * onto it.
 *
 * NFR-9 requires that every candidate for a role is asked the same things. If
 * the interview merely referenced question_template, editing that template
 * tomorrow would silently rewrite what today's candidate was asked. So we copy
 * the plan at creation time and never touch it again:
 *
 *   - template_snapshot (jsonb) is the immutable audit record.
 *   - interview_question / interview_criterion are copies that carry per-
 *     interview mutable state (the "done" checkbox, the scores).
 *
 * Both are written in the same transaction as the interview row, so an
 * interview can never exist without the plan it was created with.
 */
async function createInterview({
  orgId,
  createdBy,
  jobRoleId,
  candidateId,
  scheduledAt = null,
  panelistUserIds = [],
}) {
  return withTransaction(async (client) => {
    const { rows: roleRows } = await client.query(
      `SELECT id, title FROM job_role
       WHERE id = $1 AND org_id = $2 AND is_archived = false`,
      [jobRoleId, orgId]
    );
    if (roleRows.length === 0) throw new ApiError(404, 'Job role not found');
    const role = roleRows[0];

    const { rows: candRows } = await client.query(
      `SELECT id FROM candidate WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [candidateId, orgId]
    );
    if (candRows.length === 0) throw new ApiError(404, 'Candidate not found');

    const { rows: questions } = await client.query(
      `SELECT position, prompt, question_type FROM question_template
       WHERE job_role_id = $1 ORDER BY position`,
      [jobRoleId]
    );
    const { rows: criteria } = await client.query(
      `SELECT position, name, max_score FROM scoring_criterion
       WHERE job_role_id = $1 ORDER BY position`,
      [jobRoleId]
    );

    // A role with no plan cannot produce a fair interview.
    if (questions.length === 0) throw new ApiError(422, 'Job role has no questions');
    if (criteria.length === 0) throw new ApiError(422, 'Job role has no scoring criteria');

    const snapshot = {
      role_title: role.title,
      snapshot_at: new Date().toISOString(),
      questions,
      criteria,
    };

    // room_name is `citext UNIQUE`, so a case-insensitive collision is rejected
    // by the database rather than silently sharing a Jitsi room.
    let interview;
    for (let attempt = 1; ; attempt += 1) {
      const roomName = generateRoomName(role.title);
      // The savepoint must exist before the INSERT: a unique violation aborts the
      // whole transaction, and only ROLLBACK TO SAVEPOINT can recover it.
      await client.query('SAVEPOINT room_attempt');
      try {
        const { rows } = await client.query(
          `INSERT INTO interview
             (org_id, job_role_id, candidate_id, created_by, room_name, scheduled_at, template_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, room_name, status, scheduled_at, template_snapshot, created_at`,
          [orgId, jobRoleId, candidateId, createdBy, roomName, scheduledAt, snapshot]
        );
        await client.query('RELEASE SAVEPOINT room_attempt');
        interview = rows[0];
        break;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT room_attempt');
        const isRoomCollision =
          err.code === UNIQUE_VIOLATION && err.constraint === 'interview_room_name_key';
        if (!isRoomCollision || attempt >= ROOM_NAME_ATTEMPTS) throw err;
      }
    }

    await client.query(
      `INSERT INTO interview_question (interview_id, position, prompt, question_type)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[])`,
      [
        interview.id,
        questions.map((q) => q.position),
        questions.map((q) => q.prompt),
        questions.map((q) => q.question_type),
      ]
    );

    await client.query(
      `INSERT INTO interview_criterion (interview_id, position, name, max_score)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::int[])`,
      [
        interview.id,
        criteria.map((c) => c.position),
        criteria.map((c) => c.name),
        criteria.map((c) => c.max_score),
      ]
    );

    // The creator is the lead and the Jitsi moderator; co-interviewers are not.
    const panelIds = [...new Set([createdBy, ...panelistUserIds])];
    await client.query(
      `INSERT INTO interview_panelist (interview_id, user_id, panel_role, is_moderator)
       SELECT $1, u.id, CASE WHEN u.id = $2 THEN 'lead' ELSE 'interviewer' END,
              u.id = $2
       FROM app_user u
       WHERE u.id = ANY($3::uuid[]) AND u.org_id = $4`,
      [interview.id, createdBy, panelIds, orgId]
    );

    return interview;
  });
}

module.exports = { createInterview, ApiError };
