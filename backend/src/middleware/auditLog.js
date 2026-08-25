const db = require('../config/db');

/**
 * Records an entry in audit_log. Call this explicitly from controllers/services
 * after a state-changing action succeeds — deliberately not automatic on every
 * request, so log entries stay meaningful ("leave.approved") rather than noise
 * ("GET /leave/123").
 *
 * @param {import('express').Request} req
 * @param {{action: string, entityType: string, entityId?: string, detail?: object}} entry
 */
async function recordAudit(req, entry) {
  try {
    await db.query(
      `insert into audit_log (actor_user_id, action, entity_type, entity_id, detail, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id || null,
        entry.action,
        entry.entityType,
        entry.entityId || null,
        entry.detail ? JSON.stringify(entry.detail) : null,
        req.ip,
        req.headers['user-agent'] || null
      ]
    );
  } catch (err) {
    // Audit logging must never break the primary action — log and move on.
    console.error('Failed to write audit log entry', err);
  }
}

module.exports = { recordAudit };
