const { getAuth, clerkClient } = require('@clerk/express');
const config = require('../config');
const { pool } = require('../db/pool');

/**
 * Clerk is the source of truth for staff identity. Postgres keeps a mirror so
 * interviews can foreign-key against a stable uuid. Webhooks keep the mirror
 * fresh; this upsert makes it correct even when a webhook is missed or arrives
 * out of order.
 */
async function upsertStaff({ clerkUserId, clerkOrgId, orgName, email, name }) {
  const { rows: orgRows } = await pool.query(
    `INSERT INTO organization (clerk_org_id, name)
     VALUES ($1, $2)
     ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [clerkOrgId, orgName]
  );
  const orgId = orgRows[0].id;

  const { rows: userRows } = await pool.query(
    `INSERT INTO app_user (clerk_user_id, org_id, email, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clerk_user_id) DO UPDATE
       SET org_id = EXCLUDED.org_id,
           email  = EXCLUDED.email,
           name   = EXCLUDED.name,
           updated_at = now()
     RETURNING id, org_id, email, name`,
    [clerkUserId, orgId, email, name]
  );

  return userRows[0];
}

/** Resolve the seeded staff user without contacting Clerk. Local dev only. */
async function bypassStaff(req, res, next) {
  const clerkUserId = config.DEV_CLERK_USER_ID;
  if (!clerkUserId) {
    return res.status(500).json({ error: 'DEV_AUTH_BYPASS is on but DEV_CLERK_USER_ID is unset' });
  }
  const { rows } = await pool.query(
    `SELECT id, org_id, email, name FROM app_user WHERE clerk_user_id = $1`,
    [clerkUserId]
  );
  if (rows.length === 0) {
    return res.status(500).json({ error: `No seeded app_user for ${clerkUserId}. Run npm run seed.` });
  }
  req.staff = rows[0];
  return next();
}

/**
 * Require an authenticated staff member with an active Clerk organization, and
 * expose the mirrored row as req.staff.
 */
async function requireStaff(req, res, next) {
  if (config.DEV_AUTH_BYPASS) return bypassStaff(req, res, next);

  try {
    const { userId, orgId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Not signed in' });

    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser.primaryEmailAddress?.emailAddress ?? `${userId}@no-email.invalid`;
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ')
      || clerkUser.username || 'Unnamed';

    if (orgId) {
      // Team workspace (B2B): scope to the selected Clerk organization.
      const clerkOrg = await clerkClient.organizations.getOrganization({ organizationId: orgId });

      req.staff = await upsertStaff({
        clerkUserId: userId,
        clerkOrgId: orgId,
        orgName: clerkOrg.name,
        email,
        name,
      });
    } else {
      // Personal workspace (B2C): no team org selected, so the user IS their own
      // single-member org. Interviews still foreign-key to a real organization
      // row (keyed to the user), and the user can join or create a team org later
      // with no migration.
      req.staff = await upsertStaff({
        clerkUserId: userId,
        clerkOrgId: `personal:${userId}`,
        orgName: name === 'Unnamed' ? 'Personal workspace' : `${name} (personal)`,
        email,
        name,
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireStaff, upsertStaff };
