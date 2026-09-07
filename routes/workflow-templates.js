// backend/routes/workflow-templates.js
const express = require('express');
const router = express.Router();
const workflowTemplateController = require('../controllers/workflowTemplateController');

router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});

router.post('/save', workflowTemplateController.saveWorkflow);
router.get('/', workflowTemplateController.getAllTemplates);
router.post('/', workflowTemplateController.createTemplate);

router.get('/work-type/:workTypeId', workflowTemplateController.getGlobalTemplate);
router.get('/client/:clientId/work-type/:workTypeId', workflowTemplateController.resolveTemplate);
router.get('/client/:clientId', workflowTemplateController.getClientTemplates);

router.post('/:templateId/steps', workflowTemplateController.upsertSteps);
router.put('/steps/:stepId', workflowTemplateController.updateStep);
router.delete('/steps/:stepId', workflowTemplateController.deleteStep);

router.post('/:id/clone', workflowTemplateController.cloneTemplate);
router.post('/:id/assets/upload-url', workflowTemplateController.generateUploadUrl);
router.post('/audio/upload-url', workflowTemplateController.generateAudioUploadUrl);

router.put('/:id', workflowTemplateController.updateTemplate);
router.delete('/:id', workflowTemplateController.deleteTemplate);

module.exports = router;
