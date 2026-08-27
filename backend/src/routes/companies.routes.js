const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/companies.controller');

const router = express.Router();

// Every company endpoint requires a valid Braco portal session.
router.use(requireAuth);

// Basic company directory.
// Available to any authenticated portal user because the frontend needs
// company names for profiles, dropdowns, dashboards, and labels.
router.get('/', controller.list);

// Single-company lookup.
router.get('/:id', controller.getById);

module.exports = router;