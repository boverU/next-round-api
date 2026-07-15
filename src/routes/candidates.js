const express = require('express');
const { z } = require('zod');
const { pool } = require('../db/pool');
const { requireStaff } = require('../auth/clerk');

const router = express.Router();

router.get('/', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, headline FROM candidate
       WHERE org_id = $1 AND deleted_at IS NULL
       ORDER BY full_name`,
      [req.staff.org_id]
    );
    res.json({ candidates: rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().nullish(),
  headline: z.string().max(120).nullish(),
});

router.post('/', requireStaff, async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten().fieldErrors });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO candidate (org_id, full_name, email, headline)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, headline`,
      [req.staff.org_id, parsed.data.fullName, parsed.data.email ?? null, parsed.data.headline ?? null]
    );
    return res.status(201).json({ candidate: rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
