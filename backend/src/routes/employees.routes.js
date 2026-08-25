const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireOwnershipOrScope } = require('../middleware/rbac');
const controller = require('../controllers/employees.controller');
const leaveController = require('../controllers/leave.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/directory', controller.directory); // any authenticated staff member
router.get('/departments/allocation', requirePermission('employees.read.all'), controller.departmentAllocation);

router.get('/', requirePermission('employees.read.all'), controller.list);
router.post('/', requirePermission('employees.write'), controller.create);

router.get('/:id', requireOwnershipOrScope('employee'), controller.getById);
router.patch('/:id/deactivate', requirePermission('employees.write'), controller.deactivate);
router.patch('/:id/reactivate', requirePermission('employees.write'), controller.reactivate);

router.get('/:id/onboarding-checklist', requireOwnershipOrScope('employee'), controller.onboardingChecklist);
router.put('/:id/emergency-contact', requireOwnershipOrScope('employee'), controller.upsertEmergencyContact);
router.put('/:id/banking', requireOwnershipOrScope('employee'), controller.upsertBanking);
router.get('/:id/banking', requireOwnershipOrScope('employee'), controller.getBanking);
router.patch('/:id/contract-terms', requirePermission('contracts.manage'), controller.setContractTerms);
router.get('/:id/contract-progress', requirePermission('employees.read.all'), controller.contractProgress);

router.get('/:id/leave-balance', requireOwnershipOrScope('employee'), leaveController.balance);

module.exports = router;
