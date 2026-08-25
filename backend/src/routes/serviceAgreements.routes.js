const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const controller = require('../controllers/serviceAgreements.controller');

const router = express.Router();
router.use(requireAuth, requirePermission('agreements.manage'));

// IMPORTANT: /templates must be declared before /:id, or Express will match
// "templates" as the :id param and this route will never be reached.
router.get('/templates', controller.getTemplate);
router.put('/templates', controller.updateTemplate);

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/generate', controller.generate);

module.exports = router;

