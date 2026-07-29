const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { authenticateToken } = require('./auth');
const requireRbacPermission = require('../middleware/requireRbacPermission');

// All RBAC routes require authentication
router.use(authenticateToken);

// -- Templates --
router.get('/templates', requireRbacPermission('VIEW_RESPONSIBILITY_TEMPLATES'), rbacController.getTemplates);
router.post('/templates', requireRbacPermission('MANAGE_RESPONSIBILITY_TEMPLATES'), rbacController.createTemplate);
router.get('/templates/:templateId', requireRbacPermission('VIEW_RESPONSIBILITY_TEMPLATES'), rbacController.getTemplateById);
router.put('/templates/:templateId', requireRbacPermission('MANAGE_RESPONSIBILITY_TEMPLATES'), rbacController.updateTemplate);
router.post('/templates/:templateId/duplicate', requireRbacPermission('MANAGE_RESPONSIBILITY_TEMPLATES'), rbacController.duplicateTemplate);
router.patch('/templates/:templateId/status', requireRbacPermission('MANAGE_RESPONSIBILITY_TEMPLATES'), rbacController.updateTemplateStatus);

// -- Roles --
router.get('/roles', requireRbacPermission('MANAGE_ROLES'), rbacController.getRoles);
router.get('/users/:userId/roles', requireRbacPermission('MANAGE_ROLES'), rbacController.getUserRoles);
router.put('/users/:userId/roles', requireRbacPermission('MANAGE_ROLES'), rbacController.updateUserRoles);

// -- Users --
router.get('/users/:userId/effective-access', requireRbacPermission('VIEW_USER_RESPONSIBILITIES'), rbacController.getUserEffectiveAccess);
router.get('/users/:userId/responsibilities', requireRbacPermission('VIEW_USER_RESPONSIBILITIES'), rbacController.getUserResponsibilities);
router.get('/users/:userId/overrides', requireRbacPermission('VIEW_USER_RESPONSIBILITIES'), rbacController.getUserOverrides);
router.get('/users/:userId/audit', requireRbacPermission('VIEW_PERMISSION_AUDIT'), rbacController.getUserAudit);

// -- Preview --
router.post('/preview', requireRbacPermission('SIMULATE_ACCESS'), rbacController.previewAccess);

// -- Bulk Operations --
const bulkController = require('../controllers/bulkController');
router.post('/bulk/assign-responsibility', requireRbacPermission('ASSIGN_RESPONSIBILITIES'), bulkController.assignResponsibility);
router.post('/bulk/remove-responsibility', requireRbacPermission('REMOVE_RESPONSIBILITIES'), bulkController.removeResponsibility);
router.post('/bulk/apply-overrides', requireRbacPermission('MANAGE_PERMISSION_OVERRIDES'), bulkController.applyOverrides);
router.post('/bulk/remove-overrides', requireRbacPermission('MANAGE_PERMISSION_OVERRIDES'), bulkController.removeOverrides);

module.exports = router;
