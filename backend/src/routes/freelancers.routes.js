const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireSelfOrPermission } = require('../middleware/rbac');
const controller = require('../controllers/freelancers.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/', requirePermission('freelancers.manage'), controller.create);
router.get('/', requirePermission('freelancers.manage', 'freelancers.approve'), controller.list);
router.get('/:id', requireSelfOrPermission('freelancer', ['freelancers.manage', 'freelancers.approve']), controller.getById);
router.patch('/:id', requirePermission('freelancers.manage'), controller.update);
router.post('/:id/approve', requirePermission('freelancers.approve'), controller.approve);   // Finance only
router.post('/:id/deactivate', requirePermission('freelancers.manage'), controller.deactivate); // HR only
router.put('/:id/banking', requireSelfOrPermission('freelancer', ['freelancers.manage']), controller.upsertBanking);
router.put('/:id/contact', requireSelfOrPermission('freelancer', ['freelancers.manage']), controller.upsertContact);

module.exports = router;

