const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/db');

const router = express.Router();
router.use(requireAuth, requirePermission('audit.view'));

router.get('/', async (req, res, next) => {
  try {
    const clauses = ['1=1'];
    const params = [];
    let i = 1;
    if (req.query.actorUserId) { clauses.push(`actor_user_id = $${i}`); params.push(req.query.actorUserId); i++; }
    if (req.query.entityType) { clauses.push(`entity_type = $${i}`); params.push(req.query.entityType); i++; }
    if (req.query.from) { clauses.push(`created_at >= $${i}`); params.push(req.query.from); i++; }
    if (req.query.to) { clauses.push(`created_at <= $${i}`); params.push(req.query.to); i++; }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 25);

    const { rows } = await db.query(
      `select al.*, u.display_name as actor_name
       from audit_log al left join users u on u.id = al.actor_user_id
       where ${clauses.join(' and ')}
       order by created_at desc
       limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params
    );
    const { rows: countRows } = await db.query(`select count(*)::int as total from audit_log where ${clauses.join(' and ')}`, params);

    res.json({ data: rows, meta: { page, pageSize, total: countRows[0].total } });
  } catch (err) { next(err); }
});

module.exports = router;
