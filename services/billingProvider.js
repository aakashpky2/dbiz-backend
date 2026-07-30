// Encapsulates billable item generation for the Billing module.
// Combines Phase 1 architecture (Legacy Task-based Workflow) and Phase 2 (Work V2)
// Implements unified robust logic.

class BillingProvider {
    async getBillableWorks(supabase) {
        const logs = {
            completedTasks: 0,
            completedExecutions: 0,
            completedStepInstances: 0,
            billableWorkflowSteps: 0,
            legacyWorksFound: 0,
            taskBasedWorksFound: 0,
            alreadyBilled: 0,
            finalEligible: 0,
            details: []
        };
        const logDetail = (msg) => logs.details.push(msg);

        // 1. Fetch Billable Templates
        const { data: templates, error: tplErr } = await supabase
            .from('workflow_templates')
            .select('id, workflow_name, is_billable, billing_trigger')
            .eq('is_billable', true);
        if (tplErr) throw tplErr;

        // 2. Fetch Billable Steps
        const { data: steps, error: stpErr } = await supabase
            .from('workflow_steps')
            .select('id, workflow_template_id, step_name, is_billable, billing_trigger')
            .eq('is_billable', true);
        if (stpErr) throw stpErr;

        logs.billableWorkflowSteps = steps ? steps.length : 0;

        const templateIds = templates?.map(t => t.id) || [];
        const stepTemplateIds = steps?.map(s => s.workflow_template_id) || [];
        const allRelevantTemplateIds = [...new Set([...templateIds, ...stepTemplateIds])];

        // 3. Fetch existing invoices to prevent duplicates
        const { data: invoices, error: invErr } = await supabase
            .from('billing_invoices')
            .select('source_type, source_ref')
            .neq('status', 'cancelled');
        if (invErr) throw invErr;

        const billedWorkflowRefs = new Set(
            invoices?.filter(i => i.source_type === 'WORKFLOW' && i.source_ref).map(i => i.source_ref)
        );
        const billedStepRefs = new Set(
            invoices?.filter(i => i.source_type === 'STEP' && i.source_ref).map(i => i.source_ref)
        );

        const result = [];
        const dummyUUID = '00000000-0000-0000-0000-000000000000';
        const queryTemplateIds = allRelevantTemplateIds.length > 0 ? allRelevantTemplateIds : [dummyUUID];

        // Helper to check review status
        const isReviewPending = (reviewStatus) => {
            if (!reviewStatus) return false;
            return reviewStatus !== 'APPROVED' && reviewStatus !== 'NOT_REQUIRED';
        };

        // ==========================================
        // ARCHITECTURE A: Legacy Works -> Executions
        // ==========================================
        
        const { data: execInstances, error: execErr } = await supabase
            .from('workflow_execution_instances')
            .select('id, work_id, workflow_template_id, status')
            .in('workflow_template_id', queryTemplateIds);
        if (execErr) throw execErr;

        const completedExecs = execInstances?.filter(e => e.status === 'COMPLETED') || [];
        logs.completedExecutions = completedExecs.length;

        if (execInstances && execInstances.length > 0) {
            const execInstanceIds = execInstances.map(e => e.id);
            const workIds = [...new Set(execInstances.map(e => e.work_id).filter(Boolean))];

            // Fetch Step Instances for these Executions
            const { data: stepInstances, error: sInstErr } = await supabase
                .from('workflow_step_instances')
                .select('id, execution_instance_id, workflow_step_id, status, work_id')
                .in('execution_instance_id', execInstanceIds);
            if (sInstErr) throw sInstErr;
            
            const completedStepInsts = stepInstances?.filter(s => s.status === 'COMPLETED') || [];
            logs.completedStepInstances += completedStepInsts.length;

            // Fetch Works
            const { data: works, error: wErr } = await supabase
                .from('works')
                .select('id, work_type_name, client_id, status, review_status')
                .in('id', workIds);
            if (wErr) throw wErr;

            logs.legacyWorksFound = works ? works.length : 0;

            const clientIds = [...new Set(works?.map(w => w.client_id).filter(Boolean) || [])];
            let clients = [];
            if (clientIds.length > 0) {
                const { data: cData } = await supabase.from('clients').select('id, client_name').in('id', clientIds);
                clients = cData || [];
            }

            for (const exec of execInstances) {
                const work = works?.find(w => w.id === exec.work_id);
                if (!work) {
                    if (exec.status === 'COMPLETED') {
                        logDetail(`Missing legacy work mapping for execution: ${exec.id}`);
                    }
                    continue;
                }
                
                const client = clients.find(c => c.id === work.client_id) || {};
                
                // --- Workflow-level billing ---
                const tpl = templates?.find(t => t.id === exec.workflow_template_id);
                if (tpl && tpl.is_billable) {
                    if (exec.status !== 'COMPLETED') {
                        // In progress, skip without heavy logging to avoid noise
                    } else if (isReviewPending(work.review_status)) {
                        logDetail(`Pending review (Work): ${work.id}`);
                    } else {
                        const workflowRef = exec.id;
                        if (billedWorkflowRefs.has(workflowRef)) {
                            logs.alreadyBilled++;
                            logDetail(`Already billed WORKFLOW (Legacy): ${workflowRef}`);
                        } else {
                            result.push({
                                id: workflowRef,
                                billable_type: 'WORKFLOW',
                                source_id: exec.id,
                                source_ref: workflowRef,
                                client_id: work.client_id,
                                client_name: client.client_name || 'Unknown Client',
                                work_id: work.id,
                                work_name: work.work_type_name || 'Work',
                                title: tpl.workflow_name || 'Unknown Workflow',
                                description: 'Full Workflow',
                                professional_fee: 0,
                                government_fee: 0,
                                status: 'READY_TO_BILL'
                            });
                            logs.finalEligible++;
                        }
                    }
                }

                // --- Step-level billing ---
                const billableStepsForTemplate = steps?.filter(s => s.workflow_template_id === exec.workflow_template_id) || [];
                for (const step of billableStepsForTemplate) {
                    const stepInsts = stepInstances?.filter(si => si.execution_instance_id === exec.id && si.workflow_step_id === step.id) || [];
                    for (const stepInst of stepInsts) {
                        if (stepInst.status !== 'COMPLETED') continue;

                        const trigger = step.billing_trigger || 'ON_WORK_COMPLETION';
                        if (trigger === 'ON_WORK_COMPLETION' && work.status !== 'COMPLETED') {
                            logDetail(`Status mismatch: Step completed but Work is not completed (Legacy Work: ${work.id})`);
                            continue;
                        }

                        if (trigger === 'ON_WORK_COMPLETION' && isReviewPending(work.review_status)) {
                            logDetail(`Pending review (Work) for step billing: ${work.id}`);
                            continue;
                        }

                        const stepRef = stepInst.id;
                        if (billedStepRefs.has(stepRef)) {
                            logs.alreadyBilled++;
                            logDetail(`Already billed STEP (Legacy): ${stepRef}`);
                            continue;
                        }

                        result.push({
                            id: stepRef,
                            billable_type: 'STEP',
                            source_id: step.id,
                            source_ref: stepRef,
                            client_id: work.client_id,
                            client_name: client.client_name || 'Unknown Client',
                            work_id: work.id,
                            work_name: work.work_type_name || 'Work',
                            title: step.step_name || 'Unknown Step',
                            description: `Step: ${step.step_name}`,
                            professional_fee: 0, 
                            government_fee: 0,
                            status: 'READY_TO_BILL'
                        });
                        logs.finalEligible++;
                    }
                }
            }
        }

        // ==========================================
        // ARCHITECTURE B: Tasks
        // ==========================================
        
        const { data: tasks, error: tasksErr } = await supabase
            .from('tasks')
            .select('id, title, client_id, workflow_template_id, workflow_progress, status, review_status')
            .in('workflow_template_id', queryTemplateIds);
        if (tasksErr) throw tasksErr;

        const completedTasks = tasks?.filter(t => t.status === 'COMPLETED') || [];
        logs.completedTasks = completedTasks.length;
        logs.taskBasedWorksFound = tasks ? tasks.length : 0;

        if (tasks && tasks.length > 0) {
            const clientIds = [...new Set(tasks.map(t => t.client_id).filter(Boolean))];
            let clients = [];
            if (clientIds.length > 0) {
                const { data: cData } = await supabase.from('clients').select('id, client_name').in('id', clientIds);
                clients = cData || [];
            }

            for (const task of tasks) {
                const client = clients.find(c => c.id === task.client_id) || {};
                
                // --- Workflow-level billing ---
                const tpl = templates?.find(t => t.id === task.workflow_template_id);
                if (tpl && tpl.is_billable) {
                    if (task.status !== 'COMPLETED') {
                        // In progress, skip
                    } else if (isReviewPending(task.review_status)) {
                        logDetail(`Pending review (Task): ${task.id}`);
                    } else {
                        const workflowRef = task.id;
                        if (billedWorkflowRefs.has(workflowRef)) {
                            logs.alreadyBilled++;
                            logDetail(`Already billed WORKFLOW (Task): ${workflowRef}`);
                        } else {
                            result.push({
                                id: workflowRef,
                                billable_type: 'WORKFLOW',
                                source_id: task.id,
                                source_ref: workflowRef,
                                client_id: task.client_id,
                                client_name: client.client_name || 'Unknown Client',
                                work_id: task.id,
                                work_name: 'Task Workflow',
                                title: tpl.workflow_name || 'Unknown Workflow',
                                description: 'Full Workflow',
                                professional_fee: 0,
                                government_fee: 0,
                                status: 'READY_TO_BILL'
                            });
                            logs.finalEligible++;
                        }
                    }
                }

                // --- Step-level billing ---
                const billableStepsForTemplate = steps?.filter(s => s.workflow_template_id === task.workflow_template_id) || [];
                for (const step of billableStepsForTemplate) {
                    const progress = task.workflow_progress || {};
                    const stepProgress = progress[step.id];
                    
                    if (!stepProgress) continue;
                    if (stepProgress.status !== 'COMPLETED') continue;

                    const trigger = step.billing_trigger || 'ON_WORK_COMPLETION';
                    if (trigger === 'ON_WORK_COMPLETION' && task.status !== 'COMPLETED') {
                        logDetail(`Status mismatch: Step completed but Task is not completed (Task: ${task.id})`);
                        continue;
                    }

                    if (trigger === 'ON_WORK_COMPLETION' && isReviewPending(task.review_status)) {
                        logDetail(`Pending review (Task) for step billing: ${task.id}`);
                        continue;
                    }

                    const stepRef = `${task.id}:${step.id}`;
                    if (billedStepRefs.has(stepRef)) {
                        logs.alreadyBilled++;
                        logDetail(`Already billed STEP (Task): ${stepRef}`);
                        continue;
                    }
                    
                    result.push({
                        id: stepRef,
                        billable_type: 'STEP',
                        source_id: step.id,
                        source_ref: stepRef,
                        client_id: task.client_id,
                        client_name: client.client_name || 'Unknown Client',
                        work_id: task.id,
                        work_name: 'Task Workflow',
                        title: step.step_name || 'Unknown Step',
                        description: `Step: ${step.step_name}`,
                        professional_fee: 0, 
                        government_fee: 0,
                        status: 'READY_TO_BILL'
                    });
                    logs.finalEligible++;
                }
            }
        }

        console.log("==================================================");
        console.log("DEBUG LOGGING: BILLING PROVIDER FIX");
        console.log(`Completed Tasks: ${logs.completedTasks}`);
        console.log(`Completed Executions: ${logs.completedExecutions}`);
        console.log(`Completed Step Instances: ${logs.completedStepInstances}`);
        console.log(`Billable Workflow Steps: ${logs.billableWorkflowSteps}`);
        console.log(`Legacy Works Found: ${logs.legacyWorksFound}`);
        console.log(`Task Based Works Found: ${logs.taskBasedWorksFound}`);
        console.log(`Already Billed: ${logs.alreadyBilled}`);
        console.log(`Final Eligible: ${logs.finalEligible}`);
        logs.details.forEach(d => console.log(d));
        console.log("==================================================");

        return result;
    }
}

module.exports = new BillingProvider();
