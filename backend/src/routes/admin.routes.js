const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { recordAudit } = require('../middleware/auditLog');
const db = require('../config/db');

const router = express.Router();
router.use(requireAuth, requirePermission('admin.users'));

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select u.id, u.email, u.display_name, u.auth_provider, u.is_active, u.last_login_at,
              coalesce(array_agg(r.key) filter (where r.key is not null), '{}') as roles
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       group by u.id order by u.display_name`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.patch('/users/:id/roles', async (req, res, next) => {
  try {
    const { roleKeys } = z.object({ roleKeys: z.array(z.string()) }).parse(req.body);
    await db.query('delete from user_roles where user_id = $1', [req.params.id]);
    if (roleKeys.length) {
      await db.query(
        `insert into user_roles (user_id, role_id, granted_by)
         select $1, r.id, $2 from roles r where r.key = any($3)`,
        [req.params.id, req.user.id, roleKeys]
      );
    }
    await recordAudit(req, { action: 'admin.roles_changed', entityType: 'user', entityId: req.params.id, detail: { roleKeys } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/companies', requirePermission('admin.companies'), async (req, res, next) => {
  try {
    const { name, legalName } = z.object({ name: z.string().min(1), legalName: z.string().optional() }).parse(req.body);
    const { rows } = await db.query('insert into companies (name, legal_name) values ($1,$2) returning *', [name, legalName]);
    await recordAudit(req, { action: 'admin.company_created', entityType: 'company', entityId: rows[0].id });
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/departments', requirePermission('admin.companies'), async (req, res, next) => {
  try {
    const { companyId, name } = z.object({ companyId: z.string().uuid(), name: z.string().min(1) }).parse(req.body);
    const { rows } = await db.query('insert into departments (company_id, name) values ($1,$2) returning *', [companyId, name]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
