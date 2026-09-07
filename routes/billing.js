const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const billingSeriesController = require('../controllers/billingSeriesController');

// ==========================================
// BILLING NUMBER SERIES CONFIGURATION & RESOLUTION
// ==========================================
router.get('/series', billingSeriesController.listSeries);
router.post('/series', billingSeriesController.createSeries);
router.put('/series/:id', billingSeriesController.updateSeries);
router.delete('/series/:id', billingSeriesController.deleteSeries);
router.post('/series/resolve', billingSeriesController.resolveSeries);

// ==========================================
// BILLING INVOICES & STATS
// ==========================================
// GET /api/billing/stats
router.get('/stats', billingController.getStats);

// GET /api/billing/billable-works
router.get('/billable-works', billingController.getBillableWorks);

// GET /api/billing/eligible-steps/:workId
router.get('/eligible-steps/:workId', billingController.getEligibleSteps);

// GET /api/billing/autofill-data/:workId
router.get('/autofill-data/:workId', billingController.getAutofillData);

// GET /api/billing
router.get('/', billingController.getInvoices);

// GET /api/billing/:id
router.get('/:id', billingController.getInvoice);

// PUT /api/billing/:id
router.put('/:id', billingController.updateInvoice);

// POST /api/billing
router.post('/', billingController.createInvoice);

// PATCH /api/billing/:id/approve
router.patch('/:id/approve', billingController.approveInvoice);

// PATCH /api/billing/:id/generate-invoice
router.patch('/:id/generate-invoice', billingController.generateTaxInvoice);

// POST /api/billing/:id/payments
router.post('/:id/payments', billingController.addPayment);

// PATCH /api/billing/:id/cancel
router.patch('/:id/cancel', billingController.cancelInvoice);

module.exports = router;
