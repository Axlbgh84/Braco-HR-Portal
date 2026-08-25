const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../config/db');

/**
 * Validates the Express-issued session token (NOT the raw Entra/Supabase token —
 * those are only used once, during /auth/entra/callback and /auth/freelancer/verify,
 * to establish identity. Every subsequent request uses our own short-lived JWT so
 * token validation logic lives in exactly one place and sessions can be revoked
 * without depending on the identity provider.)
 *
 * Populates req.user = { id, email, displayName, roles: string[], permissions: string[] }
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.session;
    if (!token) {
      return res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'No session token provided.' } });
    }

    let payload;
    try {
      payload = jwt.verify(token, env.sessionJwtSecret);
    } catch (err) {
      return res.status(401).json({ error: { code: 'INVALID_SESSION', message: 'Session is invalid or expired.' } });
    }

    // Re-check user is still active and pull current roles/permissions fresh on every
    // request — deliberately not trusting stale claims baked into the token, since a
    // role revocation or account deactivation must take effect immediately.
    const { rows } = await db.query(
      `select u.id, u.email, u.display_name, u.is_active,
              coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}') as roles,
              coalesce(array_agg(distinct p.key) filter (where p.key is not null), '{}') as permissions
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       left join permissions p on p.id = rp.permission_id
       where u.id = $1
       group by u.id`,
      [payload.sub]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active.' } });
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      roles: user.roles,
      permissions: user.permissions
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
