/**
 * Seeds the org, recruiter, role, plan and candidate from the nextround20 demo
 * screens, so the local API has something to create an interview against.
 * Idempotent: re-running it updates rather than duplicates.
 */
const { pool } = require('../src/db/pool');

const CLERK_ORG_ID = 'org_dev_seed';
const CLERK_USER_ID = process.env.DEV_CLERK_USER_ID || 'user_dev_seed';

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
  const { rows: orgRows } = await pool.query(
    `INSERT INTO organization (clerk_org_id, name) VALUES ($1, $2)
     ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [CLERK_ORG_ID, 'Acme Corp']
  );
  const orgId = orgRows[0].id;

  const { rows: userRows } = await pool.query(
    `INSERT INTO app_user (clerk_user_id, org_id, email, name, avatar_color)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (clerk_user_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [CLERK_USER_ID, orgId, 'dana.morales@acme.example', 'Dana Morales', 'purple']
  );
  const userId = userRows[0].id;

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
    [orgId, 'aida.karimova@email.com']
  );
  let candidateId = candRows[0]?.id;
  if (!candidateId) {
    const { rows } = await pool.query(
      `INSERT INTO candidate (org_id, full_name, email, headline, avatar_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, 'Aida Karimova', 'aida.karimova@email.com', '6 yrs · Backend', 'teal']
    );
    candidateId = rows[0].id;
  }

  console.log('Seeded:');
  console.log(`  organization ${orgId} (clerk_org_id=${CLERK_ORG_ID})`);
  console.log(`  app_user     ${userId} (clerk_user_id=${CLERK_USER_ID})`);
  console.log(`  job_role     ${roleId} — Senior Backend Engineer, ${QUESTIONS.length} questions`);
  console.log(`  candidate    ${candidateId} — Aida Karimova`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
