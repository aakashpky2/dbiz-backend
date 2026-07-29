const { supabase } = require('../lib/supabase');

class WorkflowRuntimeService {
    
    /**
     * Resolves the authoritative runtime step instance ID.
     * Implements strict backwards compatibility for callers that still pass the template step ID.
     */
    static async resolveStepInstanceId(workId, suppliedStepId) {
        // 0. Robust check: is workId actually a step_instance_id?
        let actualWorkId = workId;
        const { data: maybeStep } = await supabase
            .from('workflow_step_instances')
            .select('execution:workflow_execution_instances(work_id)')
            .eq('id', workId)
            .maybeSingle();
            
        if (maybeStep && maybeStep.execution) {
            actualWorkId = maybeStep.execution.work_id;
        }

        // 1. Resolve current active execution for the work
        const { data: executions, error: execErr } = await supabase
            .from('workflow_execution_instances')
            .select('id, status, template_id')
            .eq('work_id', actualWorkId)
            .neq('status', 'CANCELLED')
            .order('created_at', { ascending: false });

        if (execErr || !executions || executions.length === 0) {
            throw { status: 404, message: 'Workflow execution instance was not found.' };
        }

        // Prefer IN_PROGRESS over NOT_STARTED if multiple, but enforce strict resolution
        let activeExec = executions.find(e => e.status === 'IN_PROGRESS');
        if (!activeExec) activeExec = executions.find(e => e.status === 'NOT_STARTED');
        if (!activeExec) activeExec = executions[0]; // fallback to most recent

        // 2. Query step instances
        const { data: steps, error: stepsErr } = await supabase
            .from('workflow_step_instances')
            .select('id')
            .eq('execution_instance_id', activeExec.id)
            .or(`id.eq.${suppliedStepId},workflow_step_id.eq.${suppliedStepId}`);

        if (stepsErr || !steps || steps.length === 0) {
            throw { status: 404, message: 'Workflow step execution instance was not found.' };
        }

        if (steps.length > 1) {
            throw { status: 409, message: 'Multiple runtime step instances matched the supplied template step.' };
        }

        return { stepInstanceId: steps[0].id, executionInstanceId: activeExec.id };
    }

    /**
     * Safely merges field definitions normalizing mixed-case variants.
     */
    static normalizeFieldDefs(rawFields) {
        if (!Array.isArray(rawFields)) return [];
        return rawFields.map(f => {
            const key = String(f?.fieldKey ?? f?.field_key ?? f?.key ?? '');
            const type = String(f?.fieldType ?? f?.field_type ?? f?.type ?? 'TEXT');
            return { key, type, required: Boolean(f?.required ?? f?.is_required) };
        });
    }

    /**
     * Phase 3B: Save Draft
     */
    static async saveStepDraft({ workId, stepInstanceId, remarks, customFieldValues, nonFileDocumentValues, employeeContext }) {
        // Find exact step
        const { data: step, error: stepErr } = await supabase
            .from('workflow_step_instances')
            .select(`
                *,
                execution:workflow_execution_instances!inner(work_id, status)
            `)
            .eq('id', stepInstanceId)
            .single();

        if (stepErr || !step) throw { status: 404, message: 'Step instance not found.' };
        if (step.execution.work_id !== workId) throw { status: 422, message: 'Step does not belong to specified Work.' };
        if (step.execution.status === 'COMPLETED' || step.execution.status === 'CANCELLED') throw { status: 422, message: 'Execution is completed or cancelled.' };
        if (step.status === 'COMPLETED') throw { status: 422, message: 'Cannot save draft on a completed step.' };
        // Check permission if needed

        // Load template defs for validation
        const { data: tplStep } = await supabase.from('workflow_steps').select('custom_fields, document_fields').eq('id', step.workflow_step_id).single();
        
        const existingCustom = step.custom_field_values || {};
        const existingDocs = step.document_values || {};

        const validCustomKeys = new Set(this.normalizeFieldDefs(tplStep?.custom_fields).map(f => f.key));
        const normalizedDocs = this.normalizeFieldDefs(tplStep?.document_fields);
        const validNonFileDocKeys = new Set(normalizedDocs.filter(f => !['file','image','pdf'].includes(f.type.toLowerCase())).map(f => f.key));

        const mergedCustom = { ...existingCustom };
        if (customFieldValues) {
            for (const [k, v] of Object.entries(customFieldValues)) {
                if (validCustomKeys.has(k)) mergedCustom[k] = v;
            }
        }

        const mergedDocs = { ...existingDocs };
        if (nonFileDocumentValues) {
            for (const [k, v] of Object.entries(nonFileDocumentValues)) {
                if (validNonFileDocKeys.has(k)) {
                    mergedDocs[k] = v;
                }
            }
        }
        
        // Persist
        const updatePayload = {
            custom_field_values: mergedCustom,
            document_values: mergedDocs
        };
        if (remarks !== undefined) updatePayload.remarks = remarks;

        const { error: updErr } = await supabase.from('workflow_step_instances').update(updatePayload).eq('id', stepInstanceId);
        if (updErr) throw { status: 500, message: 'Failed to update step draft.', error: updErr };

        // Optional log: Fields saved
        // We will insert a log if remarks/fields changed meaningfully, but to avoid spam, we rely on frontend save explicit clicks.
        await supabase.from('workflow_step_activity_logs').insert({
            step_instance_id: stepInstanceId,
            work_id: workId,
            action: 'FIELDS_SAVED',
            performed_by: employeeContext.employeeId,
            remarks: 'Draft saved'
        });

        // Return updated step
        const { data: updatedStep } = await supabase.from('workflow_step_instances').select('*').eq('id', stepInstanceId).single();
        return updatedStep;
    }

    /**
     * Phase 3B: Complete Step
     */
    static async completeStep({ workId, stepInstanceId, employeeContext }) {
        // Find exact step
        const { data: step, error: stepErr } = await supabase
            .from('workflow_step_instances')
            .select(`
                *,
                execution:workflow_execution_instances!inner(id, work_id, status)
            `)
            .eq('id', stepInstanceId)
            .single();

        if (stepErr || !step) throw { status: 404, message: 'Step instance not found.' };
        if (step.execution.work_id !== workId) throw { status: 422, message: 'Step does not belong to specified Work.' };
        if (step.execution.status === 'COMPLETED' || step.execution.status === 'CANCELLED') throw { status: 422, message: 'Execution is completed or cancelled.' };

        // Idempotent retry
        if (step.status === 'COMPLETED') {
            return {
                idempotent: true,
                step,
                execution: { id: step.execution.id, status: step.execution.status, progressPercentage: null }, // Need to calculate or fetch actual
                unlockedStepIds: [],
                allStepsComplete: false
            };
        }

        if (step.status === 'LOCKED' || step.status === 'BLOCKED') {
             throw { status: 422, message: 'Step cannot be completed in its current status.' };
        }

        // Validate required fields
        const { data: tplStep } = await supabase.from('workflow_steps').select('custom_fields, document_fields').eq('id', step.workflow_step_id).single();
        
        const docsDefs = this.normalizeFieldDefs(tplStep?.document_fields);
        for (const doc of docsDefs) {
            if (doc.required) {
                const val = (step.document_values || {})[doc.key];
                const isFile = ['file','image','pdf'].includes(doc.type.toLowerCase());
                if (isFile) {
                    if (!val || val.uploaded !== true || !val.storagePath) {
                        throw { status: 422, message: `Required document missing: ${doc.key}` };
                    }
                } else if (doc.type.toLowerCase() === 'checkbox') {
                    if (!val) throw { status: 422, message: `Required confirmation missing: ${doc.key}` };
                } else {
                    if (val === undefined || val === null || val === '') throw { status: 422, message: `Required field missing: ${doc.key}` };
                }
            }
        }

        const customDefs = this.normalizeFieldDefs(tplStep?.custom_fields);
        for (const c of customDefs) {
            if (c.required) {
                const val = (step.custom_field_values || {})[c.key];
                if (val === undefined || val === null || val === '') {
                    throw { status: 422, message: `Required custom field missing: ${c.key}` };
                }
            }
        }

        // All validations pass, call RPC
        const { data: rpcResult, error: rpcErr } = await supabase.rpc('complete_workflow_step', {
            p_step_id: stepInstanceId,
            p_employee_id: employeeContext.employeeId
        });

        if (rpcErr) {
            throw { status: 500, message: 'Transaction failed completing step.', error: rpcErr };
        }

        return rpcResult; // { step, execution, unlockedStepIds, allStepsComplete }
    }

    /**
     * Explicitly marks a parent Work as COMPLETED, closing active sessions.
     * Validates that all mandatory steps and documents are fulfilled.
     */
    static async completeWork({ workId, employeeContext }) {
        const { data: work, error: workErr } = await supabase
            .from('works')
            .select('*')
            .eq('id', workId)
            .maybeSingle();

        if (workErr || !work) throw { status: 404, message: 'Work not found.' };

        // Ensure active execution
        const { data: executions } = await supabase
            .from('workflow_execution_instances')
            .select('*')
            .eq('work_id', work.id)
            .neq('status', 'CANCELLED')
            .order('created_at', { ascending: false });

        let execInstance = executions?.find(e => e.status === 'IN_PROGRESS' || e.status === 'COMPLETED');
        if (!execInstance) execInstance = executions?.[0];

        if (!execInstance) {
            throw { status: 400, message: 'No active workflow execution found.' };
        }

        // Fetch steps and definitions
        const { data: stepInsts, error: stepErr } = await supabase
            .from('workflow_step_instances')
            .select('*, workflow_steps(*)')
            .eq('execution_instance_id', execInstance.id);
            
        if (stepErr) throw { status: 500, message: stepErr.message };

        if (stepInsts) {
            for (const si of stepInsts) {
                const def = si.workflow_steps;
                if (!def || !def.is_mandatory) continue;

                if (si.status !== 'COMPLETED' && si.status !== 'SKIPPED') {
                    throw { status: 400, message: 'Upload all mandatory documents and complete all mandatory workflow steps before marking this work complete.' };
                }

                // Validate documents
                let docFields = [];
                if (Array.isArray(def.document_fields)) docFields = def.document_fields;
                else if (typeof def.document_fields === 'string') {
                    try { docFields = JSON.parse(def.document_fields); } catch (e) {}
                }
                
                for (const df of docFields) {
                    if (df && (df.required || df.is_required)) {
                        const label = String(df.fieldName ?? df.field_name ?? df.label ?? df.field_label ?? df.name ?? df.title ?? df.key ?? df.fieldKey ?? df.field_key ?? '');
                        const key = df.fieldKey || df.field_key || df.key || (label || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                        const docType = (df.fieldType || df.field_type || df.type || '').toLowerCase();
                        
                        const val = (si.document_values || {})[key];
                        
                        if (['file', 'pdf', 'image'].includes(docType)) {
                            if (!val || typeof val !== 'object' || val.uploaded !== true || typeof val.storagePath !== 'string' || !val.storagePath.trim()) {
                                throw { status: 400, message: 'Upload all mandatory documents and complete all mandatory workflow steps before marking this work complete.' };
                            }
                            const maxSizeMB = parseFloat(df.maxSizeMB || df.max_size_mb) || 5;
                            if (Number(val.size) > maxSizeMB * 1024 * 1024) {
                                throw { status: 400, message: `Document ${label} exceeds maximum size of ${maxSizeMB}MB.` };
                            }
                        } else if (docType === 'checkbox') {
                            if (!val) throw { status: 400, message: 'Upload all mandatory documents and complete all mandatory workflow steps before marking this work complete.' };
                        } else {
                            if (!val || String(val).trim() === '') throw { status: 400, message: 'Upload all mandatory documents and complete all mandatory workflow steps before marking this work complete.' };
                        }
                    }
                }
                
                // Validate custom fields
                let customFields = [];
                if (Array.isArray(def.custom_fields)) customFields = def.custom_fields;
                else if (typeof def.custom_fields === 'string') {
                    try { customFields = JSON.parse(def.custom_fields); } catch (e) {}
                }
                
                for (const cf of customFields) {
                    if (cf && (cf.required || cf.is_required)) {
                        const key = cf.key || cf.fieldKey;
                        const val = (si.custom_field_values || {})[key];
                        if (!val || String(val).trim() === '') {
                            throw { status: 400, message: 'Complete all mandatory custom fields before marking this work complete.' };
                        }
                    }
                }
            }
        }

        // Update execution instance
        const now = new Date().toISOString();
        await supabase
            .from('workflow_execution_instances')
            .update({
                status: 'COMPLETED',
                actual_completed_at: now,
                progress_percentage: 100
            })
            .eq('id', execInstance.id);

        // Update work
        await supabase
            .from('works')
            .update({
                status: 'COMPLETED',
                workflow_status: 'COMPLETED'
            })
            .eq('id', work.id);

        // Close active session for the current user for this work
        if (employeeContext?.employeeId) {
            const { data: activeWorks } = await supabase
                .from('user_active_work')
                .select('*')
                .eq('work_id', work.id)
                .eq('employee_id', employeeContext.employeeId)
                .in('status', ['in_progress', 'paused']);

            if (activeWorks && activeWorks.length > 0) {
                const jsNow = new Date();
                for (const aw of activeWorks) {
                    let additionalSeconds = 0;
                    if (aw.status === 'in_progress') {
                        const lastActivity = new Date(aw.last_activity_at);
                        additionalSeconds = Math.floor((jsNow - lastActivity) / 1000);
                    }
                    const newElapsed = (aw.elapsed_seconds || 0) + Math.max(0, additionalSeconds);

                    await supabase.from('user_active_work')
                        .update({
                            status: 'completed',
                            completed_at: now,
                            elapsed_seconds: newElapsed,
                            last_activity_at: now,
                            progress: 100
                        })
                        .eq('id', aw.id);
                }
            }
        }

        return { work };
    }
}

module.exports = WorkflowRuntimeService;
