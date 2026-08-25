const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireOwnershipOrScope } = require('../middleware/rbac');
const controller = require('../controllers/contracts.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/templates', requirePermission('contracts.manage'), controller.getTemplate);
router.put('/templates', requirePermission('contracts.manage'), controller.updateTemplate);
router.post('/employees/:id/generate', requirePermission('contracts.manage'), controller.generate);
router.get('/employees/:id/latest', requireOwnershipOrScope('employee'), controller.getLatest);
router.put('/employees/:id/:documentId/amend', requirePermission('contracts.manage'), controller.amend);

module.exports = router;

