/**
 * Seeds a demo role (with its frozen-able question plan + criteria) and a
 * candidate under an EXISTING organization, identified by its Clerk org id.
 *
 * Use this to give a real Clerk org (created via sign-in) something to create
 * an interview against:
 *
 *   CLERK_ORG_ID=org_xxx npm run seed:org
 *
 * Idempotent: re-running updates rather than duplicates.
 */
const { pool } = require('../src/db/pool');

const CLERK_ORG_ID = process.env.CLERK_ORG_ID;

const QUESTIONS = [
  [1, 'Warm-up: walk me through a recent system you built', 'behavioral'],
  [2, 'Design a rate limiter', 'coding'],
  [3, 'Scale it to 10k req/s — trade-offs', 'system'],
  [4, 'Debug a race condition', 'coding'],
  [5, 'Candidate questions & wrap-up', 'behavioral'],
];

const CRITERIA = [
  [1, 'Problem solving', 5],
  [2, 'Coding & correctness', 5],
  [3, 'System design', 5],
  [4, 'Communication', 5],
  [5, 'Culture add', 5],
];

async function main() {
  if (!CLERK_ORG_ID) {
    console.error('Set CLERK_ORG_ID=org_xxx (the Clerk organization to seed into).');
    process.exit(1);
  }

  const { rows: orgRows } = await pool.query(
    `SELECT id, name FROM organization WHERE clerk_org_id = $1`,
    [CLERK_ORG_ID]
  );
  if (orgRows.length === 0) {
    console.error(`No organization mirrored for ${CLERK_ORG_ID}. Sign in once so the webhook/JIT upsert creates it, then rerun.`);
    process.exit(1);
  }
  const orgId = orgRows[0].id;

  const { rows: roleRows } = await pool.query(
    `INSERT INTO job_role (org_id, title, track) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, title) DO UPDATE SET track = EXCLUDED.track
     RETURNING id`,
    [orgId, 'Senior Backend Engineer', 'Backend']
  );
  const roleId = roleRows[0].id;

  for (const [position, prompt, type] of QUESTIONS) {
    await pool.query(
      `INSERT INTO question_template (job_role_id, position, prompt, question_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_role_id, position) DO UPDATE
         SET prompt = EXCLUDED.prompt, question_type = EXCLUDED.question_type`,
      [roleId, position, prompt, type]
    );
  }

  for (const [position, name, maxScore] of CRITERIA) {
    await pool.query(
      `INSERT INTO scoring_criterion (job_role_id, position, name, max_score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_role_id, position) DO UPDATE SET name = EXCLUDED.name`,
      [roleId, position, name, maxScore]
    );
  }

  const { rows: candRows } = await pool.query(
    `SELECT id FROM candidate WHERE org_id = $1 AND email = $2`,
    [orgId, 'jordan.lee@email.com']
  );
  let candidateId = candRows[0]?.id;
  if (!candidateId) {
    const { rows } = await pool.query(
      `INSERT INTO candidate (org_id, full_name, email, headline, avatar_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, 'Jordan Lee', 'jordan.lee@email.com', '5 yrs · Backend', 'indigo']
    );
    candidateId = rows[0].id;
  }

  console.log(`Seeded into org ${orgRows[0].name} (${CLERK_ORG_ID}):`);
  console.log(`  job_role  ${roleId} — Senior Backend Engineer, ${QUESTIONS.length} questions / ${CRITERIA.length} criteria`);
  console.log(`  candidate ${candidateId} — Jordan Lee`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
