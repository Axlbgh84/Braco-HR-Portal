const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireSelfOrPermission } = require('../middleware/rbac');
const controller = require('../controllers/workSubmissions.controller');

const router = express.Router();
router.use(requireAuth);

// Pipeline: freelancer submits -> assigned supervisor approves/rejects ->
// freelancer explicitly submits-to-finance (generates the invoice number) ->
// finance marks paid. Ownership for approve/reject is re-checked inside the
// service (must be the SPECIFIC assigned supervisor, not any supervisor).
router.post('/', controller.submit); // any authenticated freelancer; service verifies freelancerId belongs to req.user
router.get('/', controller.list);    // service scopes results by caller identity
router.post('/:id/approve', requirePermission('work.review'), controller.approve);
router.post('/:id/reject', requirePermission('work.review'), controller.reject);
router.post('/:id/submit-to-finance', controller.submitToFinance); // freelancer(self) only — enforced in service
router.post('/:id/mark-paid', requirePermission('work.pay'), controller.markPaid);

module.exports = router;

