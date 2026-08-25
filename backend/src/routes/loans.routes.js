const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireOwnershipOrScope } = require('../middleware/rbac');
const controller = require('../controllers/loans.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/', requirePermission('loans.request'), controller.submit);
router.get('/', requirePermission('loans.request', 'loans.approve.manager', 'loans.approve.hr', 'loans.approve.finance'), controller.list);
router.post('/:id/approve',
  requirePermission('loans.approve.manager', 'loans.approve.hr', 'loans.approve.finance'),
  requireOwnershipOrScope('loan'),
  controller.approve
);
router.post('/:id/reject',
  requirePermission('loans.approve.manager', 'loans.approve.hr', 'loans.approve.finance'),
  requireOwnershipOrScope('loan'),
  controller.reject
);
router.post('/:id/disburse', requirePermission('loans.approve.finance'), controller.disburse);
router.patch('/:id/repayments/:period', requirePermission('loans.approve.finance'), controller.updateRepayment);

module.exports = router;

