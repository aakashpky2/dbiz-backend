// backend/controllers/workflowTemplateController.js
const { supabase } = require('../lib/supabase');
const InheritanceResolverService = require('../services/InheritanceResolverService');
const crypto = require('crypto');

const WORKFLOW_TEMPLATE_COLUMNS = [
    'id', 'work_type_id', 'workflow_name', 'description', 'version', 'scope', 'client_id',
    'status', 'is_active', 'is_billable', 'billing_trigger',
    'created_at', 'updated_at',
    'common_information_fields', 'inheritance_mode', 'cloned_from_workflow_id', 'clone_label', 'lineage_root_id'
];

const WORKFLOW_STEP_COLUMNS = [
    'id', 'workflow_template_id', 'step_order', 'step_name', 'long_description',
    'status', 'step_type', 'video_enabled', 'video_url', 'audio_enabled', 'audio_file_url',
    'document_fields', 'custom_fields', 'step_due_date_rule', 'step_finish_date_rule',
    'is_mandatory', 'depends_on_step_ids', 'assigned_department_id', 'assigned_role',
    'estimated_time', 'reminder_days_before', 'approval_required', 'is_billable', 'billing_category', 'billing_trigger'
];

function isUuid(value) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return typeof value === 'string' && uuidRegex.test(value);
}

function sanitizePayload(payload, allowedColumns) {
    if (!payload || typeof payload !== 'object') return {};
    const sanitized = {};
    for (const key of Object.keys(payload)) {
        if (allowedColumns.includes(key) && payload[key] !== undefined) {
            sanitized[key] = payload[key];
        }
    }
    return sanitized;
}

exports.getAllTemplates = async (req, res) => {
    try {
        const { scope } = req.query;
        let query = supabase
            .from('workflow_templates')
            .select('*, steps:workflow_steps(*)')
            .order('version', { ascending: false });

        if (scope) {
            query = query.eq('scope', scope);
        }

        const { data, error } = await query;

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching all templates:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getGlobalTemplate = async (req, res) => {
    try {
        const { workTypeId } = req.params;
        const { data: template, error } = await supabase
            .from('workflow_templates')
            .select(`
                *,
                steps:workflow_steps(*)
            `)
            .eq('work_type_id', workTypeId)
            .eq('scope', 'GLOBAL')
            .maybeSingle();

        if (error) throw error;

        if (!template) {
            return res.json({ success: true, source: 'NONE', data: null });
        }

        // Sort steps
        if (template.steps) {
            template.steps.sort((a, b) => a.step_order - b.step_order);
        }

        res.json({ success: true, source: 'GLOBAL_TEMPLATE', data: template });
    } catch (error) {
        console.error('Error fetching global template:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getClientTemplates = async (req, res) => {
    try {
        const { clientId } = req.params;
        const { data, error } = await supabase
            .from('workflow_templates')
            .select('*, steps:workflow_steps(*)')
            .eq('client_id', clientId)
            .eq('scope', 'CLIENT')
            .order('version', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching client templates:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.resolveTemplate = async (req, res) => {
    try {
        const { clientId, workTypeId } = req.params;

        // Fetch client override
        const { data: clientOverride, error: clientErr } = await supabase
            .from('workflow_templates')
            .select('*, steps:workflow_steps(*)')
            .eq('client_id', clientId)
            .eq('work_type_id', workTypeId)
            .eq('scope', 'CLIENT')
            .maybeSingle();

        if (clientErr) throw clientErr;

        // Fetch global template
        const { data: globalTemplate, error: globalErr } = await supabase
            .from('workflow_templates')
            .select('*, steps:workflow_steps(*)')
            .eq('work_type_id', workTypeId)
            .eq('scope', 'GLOBAL')
            .maybeSingle();

        if (globalErr) throw globalErr;

        const resolution = InheritanceResolverService.resolveTemplateSource(clientOverride, globalTemplate);
        
        if (resolution.template && resolution.template.steps) {
            resolution.template.steps.sort((a, b) => a.step_order - b.step_order);
        }

        res.json({ success: true, source: resolution.source, data: resolution.template });
    } catch (error) {
        console.error('Error resolving template:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveWorkflow = async (req, res) => {
    try {
        const { template, steps } = req.body;
        
        // 1. Validation
        if (!template || !template.workflow_name || !template.work_type_id || !steps || steps.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid payload: workflow name, work_type_id, and at least one step are required.' });
        }

        let isNewTemplate = !template.id || !isUuid(template.id);
        let oldTemplate = null;
        let oldSteps = [];

        // 2. Fetch previous state for rollback if updating
        if (!isNewTemplate) {
            const { data: origTpl, error: origTplErr } = await supabase.from('workflow_templates').select('*').eq('id', template.id).maybeSingle();
            if (!origTplErr && origTpl) {
                oldTemplate = origTpl;
            }
            const { data: origStp, error: origStpErr } = await supabase.from('workflow_steps').select('*').eq('workflow_template_id', template.id);
            if (!origStpErr && origStp) {
                oldSteps = origStp;
            }
        }

        const sanitizedTemplate = sanitizePayload(template, WORKFLOW_TEMPLATE_COLUMNS);
        if (isNewTemplate) delete sanitizedTemplate.id;

        if (sanitizedTemplate.status === 'ACTIVE') {
            sanitizedTemplate.is_active = true;
        } else if (['DRAFT', 'INACTIVE', 'ARCHIVED'].includes(sanitizedTemplate.status)) {
            sanitizedTemplate.is_active = false;
        }

        // 3. Upsert Template
        const { data: savedTemplate, error: tplErr } = await supabase
            .from('workflow_templates')
            .upsert([sanitizedTemplate])
            .select()
            .single();

        if (tplErr) throw tplErr;

        // 4. UUID mapping for new steps
        const tempIdMapping = {}; // tempId -> new UUID
        steps.forEach(s => {
            if (s.id && !isUuid(s.id)) {
                tempIdMapping[s.id] = crypto.randomUUID();
            }
        });

        // 5. Upsert Steps
        const stepsToUpsert = steps.map(s => {
            let stepId = s.id;
            if (stepId && !isUuid(stepId)) {
                stepId = tempIdMapping[stepId];
            } else if (!stepId) {
                stepId = crypto.randomUUID();
            }

            // Remap dependencies
            let remappedDeps = [];
            if (Array.isArray(s.depends_on_step_ids)) {
                remappedDeps = s.depends_on_step_ids.map(dep => tempIdMapping[dep] || dep).filter(dep => isUuid(dep));
            }

            const sanitizedStep = sanitizePayload({
                ...s,
                id: stepId,
                workflow_template_id: savedTemplate.id,
                depends_on_step_ids: remappedDeps
            }, WORKFLOW_STEP_COLUMNS);

            return sanitizedStep;
        });

        const { data: savedSteps, error: stepsErr } = await supabase
            .from('workflow_steps')
            .upsert(stepsToUpsert, { onConflict: 'id' })
            .select();

        if (stepsErr) {
            // ROLLBACK: compensating transaction
            if (isNewTemplate) {
                await supabase.from('workflow_templates').delete().eq('id', savedTemplate.id);
            } else if (oldTemplate) {
                await supabase.from('workflow_templates').upsert([oldTemplate]);
                await supabase.from('workflow_steps').delete().eq('workflow_template_id', savedTemplate.id);
                if (oldSteps.length > 0) {
                    await supabase.from('workflow_steps').upsert(oldSteps);
                }
            }
            throw stepsErr;
        }

        // 6. Soft-Delete/Hard-Delete orphaned steps
        if (!isNewTemplate) {
            const newStepIds = savedSteps.map(s => s.id);
            let deleteQuery = supabase.from('workflow_steps').delete().eq('workflow_template_id', savedTemplate.id);
            if (newStepIds.length > 0) {
                deleteQuery = deleteQuery.not('id', 'in', `(${newStepIds.join(',')})`);
            }
            const { error: delErr } = await deleteQuery;
            if (delErr) {
                console.error("Warning: Failed to cleanup old workflow steps:", delErr);
            }
        }

        // Return sorted steps
        if (savedSteps) {
            savedSteps.sort((a, b) => a.step_order - b.step_order);
        }

        res.json({ success: true, data: { template: savedTemplate, steps: savedSteps } });
    } catch (error) {
        console.error('\n=======================================');
        console.error('[Admin WorkSchedules] Error saving workflow transactionally:');
        console.error('Message:', error.message);
        if (error.details) console.error('Details:', error.details);
        if (error.hint) console.error('Hint:', error.hint);
        if (error.code) console.error('Code:', error.code);
        console.error('Full Error Object:', JSON.stringify(error, null, 2));
        console.error('=======================================\n');
        
        let userMessage = error.message || 'Unknown backend error occurred during save.';
        if (error.code === 'PGRST204') {
            userMessage = `Database schema mismatch: ${error.message}. Please run the pending database migrations.`;
        } else if (error.code === '23514') {
            userMessage = `Constraint violation: ${error.message}`;
        }

        return res.status(500).json({ 
            success: false, 
            message: userMessage,
            details: error.details, 
            hint: error.hint, 
            code: error.code 
        });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const payload = req.body;
        
        // Validation
        if (!payload || !payload.workflow_name || !payload.work_type_id) {
            return res.status(400).json({ success: false, message: 'workflow_name and work_type_id are required' });
        }

        const sanitizedPayload = sanitizePayload(payload, WORKFLOW_TEMPLATE_COLUMNS);
        
        // Remove ID if present to ensure Supabase generates a valid UUID for a new template
        delete sanitizedPayload.id;

        const { data, error } = await supabase
            .from('workflow_templates')
            .insert([sanitizedPayload])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error('Error creating template:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.details, hint: error.hint, code: error.code });
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const payload = req.body;
        
        const sanitizedPayload = sanitizePayload(payload, WORKFLOW_TEMPLATE_COLUMNS);
        delete sanitizedPayload.id; // Don't allow changing ID

        const { data, error } = await supabase
            .from('workflow_templates')
            .update(sanitizedPayload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error updating template:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.details, hint: error.hint, code: error.code });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        // Due to ON DELETE CASCADE on workflow_steps, steps will be removed automatically
        const { error } = await supabase
            .from('workflow_templates')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting template:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.upsertSteps = async (req, res) => {
    try {
        const { templateId } = req.params;
        const { steps } = req.body; // Array of steps

        if (!steps || !Array.isArray(steps)) {
            return res.status(400).json({ success: false, message: 'Invalid payload: steps array is required' });
        }

        // Assign template_id to all steps and map IDs
        const stepsToInsert = steps.map(s => {
            const stepId = (s.id && isUuid(s.id)) ? s.id : crypto.randomUUID();
            const remappedDeps = Array.isArray(s.depends_on_step_ids) 
                ? s.depends_on_step_ids.filter(dep => isUuid(dep)) 
                : [];
            
            return sanitizePayload({
                ...s,
                id: stepId,
                workflow_template_id: templateId,
                depends_on_step_ids: remappedDeps
            }, WORKFLOW_STEP_COLUMNS);
        });

        const { data, error } = await supabase
            .from('workflow_steps')
            .upsert(stepsToInsert, { onConflict: 'id' })
            .select();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error upserting steps:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.details, hint: error.hint, code: error.code });
    }
};

exports.updateStep = async (req, res) => {
    try {
        const { stepId } = req.params;
        const payload = req.body;

        const sanitizedPayload = sanitizePayload(payload, WORKFLOW_STEP_COLUMNS);
        delete sanitizedPayload.id;
        delete sanitizedPayload.workflow_template_id;

        const { data, error } = await supabase
            .from('workflow_steps')
            .update(sanitizedPayload)
            .eq('id', stepId)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error updating step:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.details, hint: error.hint, code: error.code });
    }
};

exports.deleteStep = async (req, res) => {
    try {
        const { stepId } = req.params;
        const { error } = await supabase
            .from('workflow_steps')
            .delete()
            .eq('id', stepId);

        if (error) throw error;
        res.json({ success: true, message: 'Step deleted successfully' });
    } catch (error) {
        console.error('Error deleting step:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.cloneTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            destinationScope, 
            destinationWorkTypeId, 
            destinationClientId,
            newWorkflowName,
            mode = 'COPY', // 'COPY', 'VERSION', 'REPLACE_DRAFT'
            inheritanceMode = 'INHERIT',
            selectedStepIds = [],
            copyAsDraft = true,
            copyEffectiveDates = false,
            copyMedia = true,
            copyCommonRules = true,
            copyStepRules = true,
            copyDocumentFields = true,
            copyCustomFields = true,
            cloneLabel,
            lineageRootId
        } = req.body;

        // 1. Fetch original template and steps
        const { data: original, error: origErr } = await supabase
            .from('workflow_templates')
            .select('*, steps:workflow_steps(*)')
            .eq('id', id)
            .single();

        if (origErr) throw origErr;

        // 2. Determine target version & id based on mode
        let finalVersion = 1;
        let finalLineageRoot = mode === 'VERSION' ? (original.lineage_root_id || original.id) : (lineageRootId || null);

        if (mode === 'VERSION') {
            // Find max version for this exact configuration
            const { data: maxVer, error: maxErr } = await supabase
                .from('workflow_templates')
                .select('version')
                .eq('work_type_id', original.work_type_id)
                .eq('scope', original.scope)
                .eq(original.scope === 'CLIENT' ? 'client_id' : 'id', original.scope === 'CLIENT' ? original.client_id : original.id) // Dummy check for non-client
                .order('version', { ascending: false })
                .limit(1)
                .single();
            if (!maxErr && maxVer) finalVersion = maxVer.version + 1;
        }

        if (mode === 'REPLACE_DRAFT') {
            // Delete the existing draft first if instructed
            // Simplified for this phase, assuming frontend verified safe to replace
        }

        // 3. Prepare new template payload
        const newTemplatePayload = sanitizePayload({
            work_type_id: destinationWorkTypeId || original.work_type_id,
            workflow_name: newWorkflowName || `${original.workflow_name} (${mode === 'VERSION' ? 'V' + finalVersion : 'Copy'})`,
            description: original.description,
            scope: destinationScope || original.scope,
            client_id: destinationScope === 'CLIENT' ? (destinationClientId || original.client_id) : null,
            is_active: false,
            is_draft: copyAsDraft,
            status: copyAsDraft ? 'DRAFT' : 'ACTIVE',
            version: finalVersion,
            
            common_information_fields: copyCommonRules ? (original.common_information_fields || []) : [],
            
            inheritance_mode: inheritanceMode,
            cloned_from_workflow_id: original.id,
            clone_label: cloneLabel || `Cloned from ${original.workflow_name}`,
            lineage_root_id: finalLineageRoot
        }, WORKFLOW_TEMPLATE_COLUMNS);

        const { data: newTemplate, error: tplErr } = await supabase
            .from('workflow_templates')
            .insert([newTemplatePayload])
            .select()
            .single();

        if (tplErr) throw tplErr;

        // 4. Prepare and Remap Steps
        if (original.steps && original.steps.length > 0) {
            // Filter partial steps
            let stepsToCopy = original.steps;
            if (selectedStepIds && selectedStepIds.length > 0) {
                stepsToCopy = stepsToCopy.filter(s => selectedStepIds.includes(s.id));
            }

            // Create ID mapping dictionary
            const idMapping = {};
            stepsToCopy.forEach(step => {
                idMapping[step.id] = crypto.randomUUID();
            });

            // Map and remap dependencies
            const newSteps = stepsToCopy.map(step => {
                let remappedDependencies = [];
                if (step.depends_on_step_ids && Array.isArray(step.depends_on_step_ids)) {
                    remappedDependencies = step.depends_on_step_ids
                        .map(oldId => idMapping[oldId])
                        .filter(Boolean); // removes orphans
                }

                return sanitizePayload({
                    id: idMapping[step.id],
                    workflow_template_id: newTemplate.id,
                    step_order: step.step_order,
                    step_name: step.step_name,
                    long_description: step.long_description,
                    status: 'DRAFT',
                    step_type: step.step_type,
                    
                    video_enabled: copyMedia ? step.video_enabled : false,
                    video_url: copyMedia ? step.video_url : null,
                    audio_enabled: copyMedia ? step.audio_enabled : false,
                    audio_file_url: copyMedia ? step.audio_file_url : null,
                    
                    document_fields: copyDocumentFields ? step.document_fields : [],
                    custom_fields: copyCustomFields ? step.custom_fields : [],
                    
                    step_due_date_rule: copyStepRules ? step.step_due_date_rule : {},
                    step_finish_date_rule: copyStepRules ? step.step_finish_date_rule : {},
                    assigned_department_id: copyStepRules ? step.assigned_department_id : null,
                    assigned_role: copyStepRules ? step.assigned_role : null,
                    reminder_days_before: copyStepRules ? step.reminder_days_before : null,
                    approval_required: copyStepRules ? step.approval_required : null,
                    
                    is_mandatory: step.is_mandatory,
                    estimated_time: step.estimated_time,
                    depends_on_step_ids: remappedDependencies
                }, WORKFLOW_STEP_COLUMNS);
            });

            const { error: stepsErr } = await supabase
                .from('workflow_steps')
                .insert(newSteps);

            if (stepsErr) throw stepsErr;
        }

        res.status(201).json({ success: true, data: newTemplate });
    } catch (error) {
        console.error('Error in clone Template:', error.message);
        res.status(500).json({ success: false, message: error.message, details: error.details, hint: error.hint, code: error.code });
    }
};

exports.generateUploadUrl = async (req, res) => {
    try {
        const { id } = req.params; // template id
        const { fileName, folder = 'audio' } = req.body;

        if (!fileName) {
            return res.status(400).json({ success: false, message: 'fileName is required' });
        }

        // Structure: templates/{templateId}/{folder}/{fileName}
        const filePath = `templates/${id}/${folder}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        // Create a signed URL valid for 15 minutes (900 seconds)
        // Note: Supabase createSignedUploadUrl requires a bucket name and path.
        const { data, error } = await supabase
            .storage
            .from('workflow-assets')
            .createSignedUploadUrl(filePath);

        if (error) {
            // Check if bucket doesn't exist, which happens in dev
            if (error.message.includes('Bucket not found')) {
                // We should ideally create the bucket, but let's pass the error up cleanly
                console.error('workflow-assets bucket is missing. Please create it in Supabase.');
            }
            throw error;
        }

        // The signedUrl allows a direct PUT request from the frontend
        res.json({ 
            success: true, 
            signedUrl: data.signedUrl, 
            token: data.token,
            path: filePath,
            publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/workflow-assets/${filePath}` 
        });
    } catch (error) {
        console.error('Error generating upload URL:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.generateAudioUploadUrl = async (req, res) => {
    try {
        const { fileName, contentType } = req.body;

        if (!fileName) {
            return res.status(400).json({ success: false, message: 'fileName is required' });
        }

        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `${Date.now()}_${safeFileName}`;

        const { data, error } = await supabase
            .storage
            .from('workflow-audio')
            .createSignedUploadUrl(filePath);

        if (error) {
            if (error.message.includes('Bucket not found')) {
                console.error('workflow-audio bucket is missing. Please create it in Supabase.');
            }
            throw error;
        }

        res.json({
            success: true,
            uploadUrl: data.signedUrl,
            filePath: filePath,
            publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/workflow-audio/${filePath}`
        });
    } catch (error) {
        console.error('Error generating audio upload URL:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if template is being used by execution instances
        const { count, error: countErr } = await supabase
            .from('workflow_execution_instances')
            .select('*', { count: 'exact', head: true })
            .eq('workflow_template_id', id);
            
        if (countErr) throw countErr;
        
        if (count && count > 0) {
            // Soft delete
            const { error: updateErr } = await supabase
                .from('workflow_templates')
                .update({ status: 'ARCHIVED', is_active: false })
                .eq('id', id);
            if (updateErr) throw updateErr;
            return res.json({ success: true, message: 'Template archived because it is linked to existing works.', softDeleted: true });
        } else {
            // Hard delete
            await supabase.from('workflow_steps').delete().eq('workflow_template_id', id);
            
            const { error: delErr } = await supabase
                .from('workflow_templates')
                .delete()
                .eq('id', id);
            if (delErr) throw delErr;
            
            return res.json({ success: true, message: 'Template deleted successfully.', softDeleted: false });
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
