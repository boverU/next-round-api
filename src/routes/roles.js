const express = require('express');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');

const router = express.Router();

router.get('/', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.track,
              count(DISTINCT q.id)::int AS question_count,
              count(DISTINCT c.id)::int AS criterion_count
       FROM job_role r
       LEFT JOIN question_template q ON q.job_role_id = r.id
       LEFT JOIN scoring_criterion  c ON c.job_role_id = r.id
       WHERE r.org_id = $1 AND r.is_archived = false
       GROUP BY r.id
       ORDER BY r.title`,
      [req.staff.org_id]
    );
    res.json({ roles: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/template', requireStaff, async (req, res, next) => {
  try {
    const { rows: roleRows } = await pool.query(
      `SELECT id, title, track FROM job_role WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.staff.org_id]
    );
    if (roleRows.length === 0) return res.status(404).json({ error: 'Job role not found' });

    const [{ rows: questions }, { rows: criteria }] = await Promise.all([
      pool.query(
        `SELECT position, prompt, question_type FROM question_template
         WHERE job_role_id = $1 ORDER BY position`,
        [req.params.id]
      ),
      pool.query(
        `SELECT position, name, max_score FROM scoring_criterion
         WHERE job_role_id = $1 ORDER BY position`,
        [req.params.id]
      ),
    ]);

    return res.json({ role: roleRows[0], questions, criteria });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
