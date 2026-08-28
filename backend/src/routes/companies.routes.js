const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/companies.controller');

const router = express.Router();

// Every company endpoint requires a valid Braco portal session.
router.use(requireAuth);

// Basic company directory.
router.get('/', controller.list);

// Create a new company.
router.post('/', controller.create);

// Single-company lookup.
router.get('/:id', controller.getById);

module.exports = router;