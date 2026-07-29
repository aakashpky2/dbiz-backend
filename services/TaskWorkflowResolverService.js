const { supabase } = require('../lib/supabase');

class TaskWorkflowResolverService {
    /**
     * Resolves the correct workflow template for a given task based on priority.
     * @param {Object} task The task record.
     * @returns {Promise<Object>} { source: 'CLIENT_TEMPLATE' | 'GLOBAL_TEMPLATE' | 'DIRECT_TEMPLATE' | 'NONE', template: Object }
     */
    static async resolveWorkflowForTask(task) {
        if (!task) return { source: 'NONE', template: null };

        // 1. If task already has an explicitly bound template
        if (task.workflow_template_id) {
            const { data: directTemplate } = await supabase
                .from('workflow_templates')
                .select('*')
                .eq('id', task.workflow_template_id)
                .maybeSingle();

            if (directTemplate && (directTemplate.status === 'ACTIVE' || directTemplate.is_active)) {
                return { source: 'DIRECT_TEMPLATE', template: directTemplate };
            }
        }

        // 2. Resolve by work_type_id
        if (!task.work_type_id) {
            return { source: 'NONE', template: null };
        }

        // Try CLIENT template
        if (task.client_id) {
            const { data: clientTemplate } = await supabase
                .from('workflow_templates')
                .select('*')
                .eq('scope', 'CLIENT')
                .eq('client_id', task.client_id)
                .eq('work_type_id', task.work_type_id)
                .or('status.eq.ACTIVE,is_active.eq.true')
                .maybeSingle();

            if (clientTemplate) {
                return { source: 'CLIENT_TEMPLATE', template: clientTemplate };
            }
        }

        // Fallback to GLOBAL template
        const { data: globalTemplate } = await supabase
            .from('workflow_templates')
            .select('*')
            .eq('scope', 'GLOBAL')
            .eq('work_type_id', task.work_type_id)
            .or('status.eq.ACTIVE,is_active.eq.true')
            .maybeSingle();

        if (globalTemplate) {
            return { source: 'GLOBAL_TEMPLATE', template: globalTemplate };
        }

        return { source: 'NONE', template: null };
    }

    /**
     * Fetches ordered workflow steps for a template.
     * @param {string} templateId 
     */
    static async getWorkflowSteps(templateId) {
        if (!templateId) return [];
        const { data } = await supabase
            .from('workflow_steps')
            .select(`
                id, workflow_template_id, step_order, step_name, long_description,
                status, step_type, is_mandatory,
                video_enabled, video_url,
                audio_enabled, audio_file_url,
                document_fields, custom_fields,
                step_due_date_rule, step_finish_date_rule,
                assigned_department_id, assigned_role,
                reminder_days_before, approval_required,
                estimated_time, depends_on_step_ids
            `)
            .eq('workflow_template_id', templateId)
            .order('step_order', { ascending: true });
        return (data || []).map(step => ({
            ...step,
            // Normalize array fields so frontend always gets arrays
            document_fields: Array.isArray(step.document_fields) ? step.document_fields : (step.document_fields ? [step.document_fields] : []),
            custom_fields: Array.isArray(step.custom_fields) ? step.custom_fields : (step.custom_fields ? [step.custom_fields] : []),
            depends_on_step_ids: Array.isArray(step.depends_on_step_ids) ? step.depends_on_step_ids : []
        }));
    }

    /**
     * Calculates the workflow progress based on the step definitions and the JSONB progress field.
     * @param {Object} task The task record containing workflow_progress.
     * @param {Array} steps The workflow steps.
     */
    static calculateWorkflowProgress(task, steps) {
        if (!steps || steps.length === 0) {
            return {
                totalSteps: 0,
                completedSteps: 0,
                overallProgress: 0,
                currentStep: null,
                nextStep: null
            };
        }

        const progressMap = task.workflow_progress || {};
        const totalSteps = steps.length;
        let completedSteps = 0;
        let currentStep = null;
        let nextStep = null;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepProgress = progressMap[step.id];

            if (stepProgress && stepProgress.status === 'COMPLETED') {
                completedSteps++;
            } else if (!currentStep) {
                currentStep = step;
                if (i + 1 < steps.length) {
                    nextStep = steps[i + 1];
                }
            }
        }

        const overallProgress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

        return {
            totalSteps,
            completedSteps,
            overallProgress,
            currentStep,
            nextStep
        };
    }

    /**
     * Formats the raw task, workflow, and progress into a unified frontend-friendly shape.
     */
    static formatTaskWithWorkflow(task, workflowRes, steps) {
        const { source, template } = workflowRes;
        const progressStats = this.calculateWorkflowProgress(task, steps);

        // Standardize arrays
        let assignedTo = Array.isArray(task.assigned_to) ? task.assigned_to : [];
        if (typeof task.assigned_to === 'string') {
            try { assignedTo = JSON.parse(task.assigned_to); } catch(e) {}
        }

        return {
            id: task.id,
            clientId: task.client_id,
            clientName: task.client_name || task.clients?.client_name,
            workTypeId: task.work_type_id,
            workTypeName: task.work_types?.name,
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDate: task.due_date,
            status: task.status || 'AVAILABLE',
            createdBy: task.created_by,
            assignedTo: assignedTo,
            assignedToNames: [], // Can be populated if joined with user_profiles
            claimedBy: task.claimed_by,
            claimedByName: task.claimed_by_user?.full_name || task.claimedByName,
            assignedTeamId: task.assigned_team_id,
            assignedTeamName: task.assignedTeamName,
            startedAt: task.started_at,
            completedAt: task.completed_at,
            reviewStatus: task.review_status || 'PENDING',
            reviewRemarks: task.review_remarks,
            workflowTemplateId: template ? template.id : null,
            workflowName: template ? template.workflow_name : null,
            workflowSource: source,
            hasFlow: !!template,
            totalSteps: progressStats.totalSteps,
            completedSteps: progressStats.completedSteps,
            overallProgress: progressStats.overallProgress,
            currentStep: progressStats.currentStep,
            nextStep: progressStats.nextStep,
            createdAt: task.created_at
        };
    }
}

module.exports = TaskWorkflowResolverService;
