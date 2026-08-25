const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireOwnershipOrScope } = require('../middleware/rbac');
const controller = require('../controllers/leave.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/', requirePermission('leave.request'), controller.submit);
router.get('/', requirePermission('leave.request', 'leave.approve.manager', 'leave.approve.hr'), controller.list);

router.post('/:id/approve',
  requirePermission('leave.approve.manager', 'leave.approve.hr'),
  requireOwnershipOrScope('leave'),
  controller.approve
);
router.post('/:id/reject',
  requirePermission('leave.approve.manager', 'leave.approve.hr'),
  requireOwnershipOrScope('leave'),
  controller.reject
);
router.post('/:id/cancel', requirePermission('leave.request'), controller.cancel);

module.exports = router;
