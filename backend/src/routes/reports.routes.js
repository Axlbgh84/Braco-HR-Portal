const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { notImplemented } = require('../utils/notImplemented');
const db = require('../config/db');

const router = express.Router();
router.use(requireAuth, requirePermission('reports.view'));

// --- Fully implemented, as a pattern for the rest ---

router.get('/headcount', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select c.name as company, count(*) filter (where e.active) as active_headcount,
              count(*) filter (where e.contract_type = 'temporary' and e.active) as temporary_count
       from employees e join companies c on c.id = e.company_id
       group by c.name order by c.name`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/contract-expiry', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select e.id, u.display_name, e.contract_end_date,
              (e.contract_end_date - current_date) as days_remaining
       from employees e
       join users u on u.id = e.user_id
       where e.contract_type = 'temporary' and e.active and e.contract_end_date is not null
       order by e.contract_end_date asc`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// --- Scaffolded (routing/permissions live, query to be written) ---
const todo = notImplemented('Reports');
router.get('/leave-utilization', todo);
router.get('/loan-exposure', requirePermission('reports.view'), todo);
router.get('/freelancer-spend', requirePermission('reports.view'), todo);
router.get('/export.csv', todo); // ?dataset=employees|leave|loans — stream rows through a CSV writer

module.exports = router;
