const db = require('../config/db');

/**
 * Requires the authenticated user to hold at least one of the given permissions.
 * Use permission keys from the `permissions` table (see database/schema.sql §12),
 * e.g. requirePermission('leave.approve.manager', 'leave.approve.hr').
 */
function requirePermission(...permissionKeys) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Sign in required.' } });
    }
    const hasPermission = permissionKeys.some((key) => req.user.permissions.includes(key));
    if (!hasPermission) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' }
      });
    }
    next();
  };
}

/**
 * Restricts a request to acting on the caller's own record, OR someone whose
 * employee record reports to the caller (for supervisor-scoped actions), OR
 * anyone if the caller holds a "full scope" permission like employees.read.all.
 *
 * This is the server-side enforcement that the prototype's client-side checks
 * (e.g. "only show approvals for people who report to me") were never actually
 * capable of guaranteeing — a client can always be tampered with.
 *
 * @param {'employee'|'leave'|'loan'|'workSubmission'} resourceType
 */
function requireOwnershipOrScope(resourceType) {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const targetId = req.params.id;

      if (req.user.permissions.includes('employees.read.all')) return next(); // HR/admin see everything

      const scopeQueries = {
        employee: `select 1 from employees where id = $1 and (user_id = $2 or manager_id = (select id from employees where user_id = $2))`,
        leave: `select 1 from leave_requests lr join employees e on e.id = lr.employee_id
                where lr.id = $1 and (e.user_id = $2 or e.manager_id = (select id from employees where user_id = $2))`,
        loan: `select 1 from loan_requests lo join employees e on e.id = lo.employee_id
               where lo.id = $1 and (e.user_id = $2 or e.manager_id = (select id from employees where user_id = $2))`,
        workSubmission: `select 1 from work_submissions ws join freelancers f on f.id = ws.freelancer_id
                          where ws.id = $1 and (f.user_id = $2 or f.supervisor_id = (select id from employees where user_id = $2))`
      };

      const { rows } = await db.query(scopeQueries[resourceType], [targetId, userId]);
      if (rows.length === 0) {
        return res.status(403).json({
          error: { code: 'OUT_OF_SCOPE', message: 'This record is not yours or your team\'s.' }
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * For endpoints a freelancer can act on for themselves (banking, contact info, work
 * submissions) OR that staff can act on via a normal permission. Freelancers don't
 * hold entries in `roles`/`permissions` — they're identified purely by owning the
 * `freelancers` row referenced in the URL.
 * @param {'freelancer'|'work_submission'} resourceType
 * @param {string[]} staffPermissionKeys - any of these permissions grants access regardless of ownership
 */
function requireSelfOrPermission(resourceType, staffPermissionKeys = []) {
  return async (req, res, next) => {
    try {
      if (staffPermissionKeys.some((key) => req.user.permissions.includes(key))) return next();

      const targetId = req.params.id;
      const ownershipQueries = {
        freelancer: `select 1 from freelancers where id = $1 and user_id = $2`,
        work_submission: `select 1 from work_submissions ws join freelancers f on f.id = ws.freelancer_id where ws.id = $1 and f.user_id = $2`
      };
      const { rows } = await db.query(ownershipQueries[resourceType], [targetId, req.user.id]);
      if (rows.length === 0) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your record.' } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission, requireOwnershipOrScope, requireSelfOrPermission };
