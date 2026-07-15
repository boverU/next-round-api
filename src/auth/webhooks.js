const express = require('express');
const { verifyWebhook } = require('@clerk/express/webhooks');
const { pool } = require('../db/pool');

const router = express.Router();

async function upsertOrganization(data) {
  await pool.query(
    `INSERT INTO organization (clerk_org_id, name)
     VALUES ($1, $2)
     ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    [data.id, data.name]
  );
}

async function upsertMembership(data) {
  const clerkOrgId = data.organization?.id;
  const user = data.public_user_data;
  if (!clerkOrgId || !user?.user_id) return;

  const { rows } = await pool.query(
    `SELECT id FROM organization WHERE clerk_org_id = $1`,
    [clerkOrgId]
  );
  if (rows.length === 0) return; // organization.created has not landed yet; JIT upsert will fix it

  await pool.query(
    `INSERT INTO app_user (clerk_user_id, org_id, email, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clerk_user_id) DO UPDATE
       SET org_id = EXCLUDED.org_id, name = EXCLUDED.name, updated_at = now()`,
    [
      user.user_id,
      rows[0].id,
      user.identifier ?? `${user.user_id}@no-email.invalid`,
      [user.first_name, user.last_name].filter(Boolean).join(' ') || user.identifier || 'Unnamed',
    ]
  );
}

// express.raw, not express.json: signature verification needs the exact bytes
// Clerk signed, and re-serializing a parsed object can reorder keys.
router.post('/clerk', express.raw({ type: 'application/json' }), async (req, res, next) => {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  try {
    switch (event.type) {
      case 'organization.created':
      case 'organization.updated':
        await upsertOrganization(event.data);
        break;
      case 'organizationMembership.created':
      case 'organizationMembership.updated':
        await upsertMembership(event.data);
        break;
      default:
        break; // ignore everything else
    }
    return res.json({ received: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
