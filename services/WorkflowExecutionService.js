// backend/services/WorkflowExecutionService.js

const { supabase } = require('../lib/supabase');
const InheritanceResolverService = require('./InheritanceResolverService');

class WorkflowExecutionService {
    /**
     * Decoupled date planning math calculator.
     * Computes start and finish dates topologically using minutes, hours, or days.
     * Separated so that custom business SLA calendars (weekends, holidays, office hours) can be injected later.
     * 
     * @param {Date|string} baseDate The starting anchor date.
     * @param {number} value Expected duration amount.
     * @param {string} unit Unit of duration ('minutes' | 'hours' | 'days').
     * @returns {Date} The calculated target date.
     */
    static calculateTargetDate(baseDate, value, unit = 'days') {
        const date = new Date(baseDate);
        const amount = parseInt(value, 10) || 0;
        
        switch (unit) {
            case 'minutes':
                date.setMinutes(date.getMinutes() + amount);
                break;
            case 'hours':
                date.setHours(date.getHours() + amount);
                break;
            case 'days':
            default:
                date.setDate(date.getDate() + amount);
                break;
        }
        return date;
    }

    /**
     * Resolves workflow config and instantiates runtime steps with DAG calculations.
     * Uses strict duplicate protection checks.
     * 
     * @param {string} workId The ID of the work item.
     * @returns {Promise<Object>} Initialization outcome.
     */
    static async initializeWorkflowExecution(workId) {
        try {
            console.log(`[WorkflowExecution] Starting execution setup for work: ${workId}`);
            
            // 1. Strict Duplicate Protection Check
            const { data: existingExec, error: checkError } = await supabase
                .from('workflow_execution_instances')
                .select('*')
                .eq('work_id', workId)
                .maybeSingle();

            if (checkError) throw checkError;
            if (existingExec) {
                console.log(`[WorkflowExecution] Execution instance already exists for work ${workId}. Skipping.`);
                return { success: true, alreadyExists: true, data: existingExec };
            }

            // 2. Fetch Work details
            const { data: work, error: workError } = await supabase
                .from('works')
                .select('*')
                .eq('id', workId)
                .single();

            if (workError) throw workError;
            if (!work) {
                throw new Error(`Work item not found with ID: ${workId}`);
            }

            // 3. Resolve V2 Workflow Configuration hierarchy
            // Fetch Global Template
            const { data: globals } = await supabase
                .from('workflow_templates')
                .select('*, steps:workflow_steps(*)')
                .eq('scope', 'GLOBAL')
                .eq('work_type_id', work.work_type_id)
                .eq('status', 'ACTIVE')
                .order('version', { ascending: false });

            // Fetch Client Override Template
            const { data: clientOverrides } = await supabase
                .from('workflow_templates')
                .select('*, steps:workflow_steps(*)')
                .eq('scope', 'CLIENT')
                .eq('client_id', work.client_id)
                .eq('work_type_id', work.work_type_id)
                .eq('status', 'ACTIVE')
                .order('version', { ascending: false });

            const globalTemplate = globals && globals.length > 0 ? globals[0] : null;
            const clientOverride = clientOverrides && clientOverrides.length > 0 ? clientOverrides[0] : null;

            // Resolve hierarchy
            const resolved = InheritanceResolverService.resolveTemplateSource(clientOverride, globalTemplate);
            const activeTemplate = resolved.template;

            if (!activeTemplate) {
                console.log(`[WorkflowExecution] No workflow template configured for work_type_id ${work.work_type_id} and client_id ${work.client_id}. Preserving V1 legacy fallback.`);
                return { success: true, v1Fallback: true };
            }

            // Fetch structural steps belonging to this resolved template
            const { data: templateSteps, error: stepsError } = await supabase
                .from('workflow_steps')
                .select('*')
                .eq('workflow_template_id', activeTemplate.id)
                .order('step_order', { ascending: true });

            if (stepsError) throw stepsError;
            if (!templateSteps || templateSteps.length === 0) {
                console.log(`[WorkflowExecution] resolved template ${activeTemplate.id} has no steps. Preserving V1 legacy fallback.`);
                return { success: true, v1Fallback: true };
            }

            // 4. Validate canonical Work Type ID
            const executionWorkTypeId = activeTemplate.work_type_id;
            const { data: validWorkType, error: validWorkTypeError } = await supabase
                .from('work_types')
                .select('id')
                .eq('id', executionWorkTypeId)
                .maybeSingle();

            if (validWorkTypeError) throw validWorkTypeError;
            if (!validWorkType) {
                console.error(`[WorkflowExecution] Config error: Template ${activeTemplate.id} references work_type_id ${executionWorkTypeId} missing in canonical work_types (legacy ID: ${work.work_type_id}) for work ${workId}.`);
                return { success: false, error: 'Workflow configuration error: the selected work type has not been initialized in the workflow engine.' };
            }

            // 5. Create Parent Execution Record
            const baseStart = work.created_at || new Date().toISOString();
            
            const { data: execInstance, error: execError } = await supabase
                .from('workflow_execution_instances')
                .insert([{
                    work_id: workId,
                    client_id: work.client_id,
                    work_type_id: executionWorkTypeId,
                    workflow_template_id: activeTemplate.id,
                    workflow_version: activeTemplate.version,
                    status: 'NOT_STARTED',
                    assigned_team_id: work.assigned_team_id,
                    progress_percentage: 0.00
                }])
                .select()
                .single();

            if (execError) throw execError;

            // 5. Spawn runtime step instances
            // Step 5A: Insert all step instances with empty depends list first to capture runtime UUIDs
            const insertedSteps = [];
            for (const templateStep of templateSteps) {
                // Merge common rules and step specific rules
                const resolvedRules = InheritanceResolverService.resolveStepRules(
                    activeTemplate,
                    templateStep,
                    activeTemplate.allow_step_override
                );

                const { data: stepInst, error: stepInstErr } = await supabase
                    .from('workflow_step_instances')
                    .insert([{
                        execution_instance_id: execInstance.id,
                        workflow_step_id: templateStep.id,
                        step_order: templateStep.step_order,
                        step_name: templateStep.step_name,
                        step_type: templateStep.step_type,
                        status: 'LOCKED', // Initially LOCKED, re-evaluated in topological sort
                        assigned_team_id: resolvedRules.assigned_department_id.value || work.assigned_team_id,
                        expected_duration_value: templateStep.estimated_time || 0,
                        expected_duration_unit: 'days',
                        document_values: {},
                        custom_field_values: {}
                    }])
                    .select()
                    .single();

                if (stepInstErr) throw stepInstErr;

                insertedSteps.push({
                    templateStepId: templateStep.id,
                    instanceId: stepInst.id,
                    stepOrder: templateStep.step_order,
                    originalDependencies: templateStep.depends_on_step_ids || [],
                    stepData: stepInst
                });
            }

            // Step 5B: Map template-level depends_on_step_ids to runtime step instance UUIDs
            const idMap = new Map();
            insertedSteps.forEach(item => {
                idMap.set(item.templateStepId, item.instanceId);
            });

            const stepInstancesWithMappedDependencies = [];
            for (const item of insertedSteps) {
                const runtimeDepIds = item.originalDependencies
                    .map(tempId => idMap.get(tempId))
                    .filter(instId => !!instId); // filter out unresolved IDs

                const { data: updatedStep, error: updateErr } = await supabase
                    .from('workflow_step_instances')
                    .update({ depends_on_step_instance_ids: runtimeDepIds })
                    .eq('id', item.instanceId)
                    .select()
                    .single();

                if (updateErr) throw updateErr;
                stepInstancesWithMappedDependencies.push(updatedStep);
            }

            // 6. Run Date Planning math and calculate Topologically (DAG Scheduling)
            // Sort step instances by step_order for sequential topological calculation
            const sortedInstances = [...stepInstancesWithMappedDependencies].sort((a, b) => a.step_order - b.step_order);
            const instanceMap = new Map(sortedInstances.map(s => [s.id, s]));

            for (const step of sortedInstances) {
                let plannedStart = new Date(baseStart);
                const dependencies = step.depends_on_step_instance_ids || [];

                if (dependencies.length > 0) {
                    // Start = Max Planned Finish date of ALL parent step dependencies
                    let maxParentFinish = new Date(baseStart);
                    dependencies.forEach(depId => {
                        const parent = instanceMap.get(depId);
                        if (parent && parent.planned_finish_date) {
                            const pFinish = new Date(parent.planned_finish_date);
                            if (pFinish > maxParentFinish) {
                                maxParentFinish = pFinish;
                            }
                        }
                    });
                    plannedStart = maxParentFinish;
                }

                // Finish = Start + Duration
                const plannedFinish = this.calculateTargetDate(
                    plannedStart,
                    step.expected_duration_value,
                    step.expected_duration_unit
                );

                const { data: finalStep, error: finalStepErr } = await supabase
                    .from('workflow_step_instances')
                    .update({
                        planned_start_date: plannedStart.toISOString(),
                        planned_finish_date: plannedFinish.toISOString()
                    })
                    .eq('id', step.id)
                    .select()
                    .single();

                if (finalStepErr) throw finalStepErr;
                instanceMap.set(step.id, finalStep); // update locally mapped reference
            }

            // 7. Resolve Initial Steps States (Unlock root steps with no dependencies)
            const finalInstances = Array.from(instanceMap.values());
            let maxWorkflowFinish = new Date(baseStart);

            for (const step of finalInstances) {
                // Keep track of the furthest finish date for the overall execution planned dates
                if (step.planned_finish_date) {
                    const stepFinish = new Date(step.planned_finish_date);
                    if (stepFinish > maxWorkflowFinish) {
                        maxWorkflowFinish = stepFinish;
                    }
                }

                const dependencies = step.depends_on_step_instance_ids || [];
                if (dependencies.length === 0) {
                    // Root step: Unlock and set to AVAILABLE
                    await supabase
                        .from('workflow_step_instances')
                        .update({ status: 'AVAILABLE' })
                        .eq('id', step.id);
                }
            }

            // 8. Update overall execution instance dates and set status to IN_PROGRESS
            const { data: finalExec, error: execUpdateErr } = await supabase
                .from('workflow_execution_instances')
                .update({
                    status: 'IN_PROGRESS',
                    planned_start_date: baseStart,
                    planned_finish_date: maxWorkflowFinish.toISOString(),
                    actual_started_at: new Date().toISOString()
                })
                .eq('id', execInstance.id)
                .select()
                .single();

            if (execUpdateErr) throw execUpdateErr;

            console.log(`[WorkflowExecution] V2 Workflow Execution initialized successfully for work: ${workId}. ExecutionId: ${execInstance.id}`);
            return { success: true, execution: finalExec };

        } catch (error) {
            console.error(`[WorkflowExecution] Failed to initialize execution for work: ${workId}`, error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = WorkflowExecutionService;
