// Encapsulates billable item generation for the Billing module.
// Combines Phase 1 architecture (Legacy Task-based Workflow) and Phase 2 (Work V2)

class TaskWorkflowProvider {
    async getBillableWorks(supabase) {
        // Fetch Billable Templates
        const { data: templates, error: tplErr } = await supabase
            .from('workflow_templates')
            .select('id, workflow_name, is_billable')
            .eq('is_billable', true);
        if (tplErr) throw tplErr;

        // Fetch Billable Steps
        const { data: steps, error: stpErr } = await supabase
            .from('workflow_steps')
            .select('id, workflow_template_id, step_name, is_billable')
            .eq('is_billable', true);
        if (stpErr) throw stpErr;

        const templateIds = templates?.map(t => t.id) || [];
        const stepTemplateIds = steps?.map(s => s.workflow_template_id) || [];
        const allRelevantTemplateIds = [...new Set([...templateIds, ...stepTemplateIds])];

        // Fetch Tasks
        const { data: tasks, error: tasksErr } = await supabase
            .from('tasks')
            .select('id, title, client_id, workflow_template_id, workflow_progress, status, review_status')
            .in('workflow_template_id', allRelevantTemplateIds.length > 0 ? allRelevantTemplateIds : ['00000000-0000-0000-0000-000000000000']);
        if (tasksErr) throw tasksErr;

        // Fetch existing invoices to prevent duplicates
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

        // Fetch Clients
        const clientIds = [...new Set(tasks?.map(t => t.client_id).filter(Boolean) || [])];
        let clients = [];
        if (clientIds.length > 0) {
            const { data: cData } = await supabase
                .from('clients')
                .select('id, client_name')
                .in('id', clientIds);
            clients = cData || [];
        }

        const result = [];

        for (const task of tasks || []) {
            const tpl = templates?.find(t => t.id === task.workflow_template_id);
            const isWorkflowBillable = tpl ? tpl.is_billable : false;
            
            const billableStepsForTemplate = steps?.filter(s => s.workflow_template_id === task.workflow_template_id) || [];
            const hasBillableStep = billableStepsForTemplate.length > 0;
            
            if (hasBillableStep) {
                for (const step of billableStepsForTemplate) {
                    const stepRef = `${task.id}:${step.id}`;
                    if (billedStepRefs.has(stepRef)) continue;
                    
                    const progress = task.workflow_progress || {};
                    const stepProgress = progress[step.id];
                    
                    if (!stepProgress || stepProgress.status !== 'COMPLETED' || task.review_status !== 'APPROVED') {
                        continue;
                    }
                    
                    const client = clients.find(c => c.id === task.client_id) || {};
                    
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
                }
            } else if (isWorkflowBillable) {
                const workflowRef = task.id;
                if (billedWorkflowRefs.has(workflowRef)) continue;

                if (task.status !== 'COMPLETED' || task.review_status !== 'APPROVED') {
                    continue;
                }

                const client = clients.find(c => c.id === task.client_id) || {};

                result.push({
                    id: workflowRef,
                    billable_type: 'WORKFLOW',
                    source_id: task.id,
                    source_ref: workflowRef,
                    client_id: task.client_id,
                    client_name: client.client_name || 'Unknown Client',
                    work_id: task.id,
                    work_name: 'Task Workflow',
                    title: tpl?.workflow_name || 'Unknown Workflow',
                    description: 'Full Workflow',
                    professional_fee: 0,
                    government_fee: 0,
                    status: 'READY_TO_BILL'
                });
            }
        }

        return result;
    }
}

class WorkV2BillingProvider {
    async getBillableWorks(supabase) {
        // Fetch Billable Templates
        const { data: templates, error: tplErr } = await supabase
            .from('workflow_templates')
            .select('id, workflow_name, is_billable, billing_trigger')
            .eq('is_billable', true);
        if (tplErr) throw tplErr;

        // Fetch Billable Steps
        const { data: steps, error: stpErr } = await supabase
            .from('workflow_steps')
            .select('id, workflow_template_id, step_name, is_billable, billing_trigger')
            .eq('is_billable', true);
        if (stpErr) throw stpErr;

        const templateIds = templates?.map(t => t.id) || [];
        const stepTemplateIds = steps?.map(s => s.workflow_template_id) || [];
        const allRelevantTemplateIds = [...new Set([...templateIds, ...stepTemplateIds])];

        // Fetch Execution Instances for relevant templates
        const { data: execInstances, error: execErr } = await supabase
            .from('workflow_execution_instances')
            .select('id, work_id, workflow_template_id, status')
            .in('workflow_template_id', allRelevantTemplateIds.length > 0 ? allRelevantTemplateIds : ['00000000-0000-0000-0000-000000000000']);
        if (execErr) throw execErr;

        const execInstanceIds = execInstances?.map(e => e.id) || [];
        const workIds = [...new Set(execInstances?.map(e => e.work_id).filter(Boolean) || [])];

        // Fetch Step Instances
        let stepInstances = [];
        if (execInstanceIds.length > 0) {
            const { data: sInst, error: sInstErr } = await supabase
                .from('workflow_step_instances')
                .select('id, execution_instance_id, workflow_step_id, status')
                .in('execution_instance_id', execInstanceIds);
            if (sInstErr) throw sInstErr;
            stepInstances = sInst || [];
        }

        // Fetch Works
        let works = [];
        if (workIds.length > 0) {
            const { data: wData, error: wErr } = await supabase
                .from('works')
                .select('id, work_type_name, client_id, status')
                .in('id', workIds);
            if (wErr) throw wErr;
            works = wData || [];
        }

        // Fetch Clients
        const clientIds = [...new Set(works?.map(w => w.client_id).filter(Boolean) || [])];
        let clients = [];
        if (clientIds.length > 0) {
            const { data: cData } = await supabase
                .from('clients')
                .select('id, client_name')
                .in('id', clientIds);
            clients = cData || [];
        }

        // Fetch existing invoices to prevent duplicates
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

        for (const exec of execInstances || []) {
            const tpl = templates?.find(t => t.id === exec.workflow_template_id);
            const work = works?.find(w => w.id === exec.work_id);
            if (!work) continue;
            
            const client = clients.find(c => c.id === work.client_id) || {};
            const isWorkflowBillable = tpl ? tpl.is_billable : false;
            
            const billableStepsForTemplate = steps?.filter(s => s.workflow_template_id === exec.workflow_template_id) || [];
            
            // Check step-level billing
            if (billableStepsForTemplate.length > 0) {
                for (const step of billableStepsForTemplate) {
                    const stepInstsForStep = stepInstances.filter(si => si.execution_instance_id === exec.id && si.workflow_step_id === step.id);
                    
                    for (const stepInst of stepInstsForStep) {
                        const stepRef = stepInst.id; // Use stable step instance ID
                        if (billedStepRefs.has(stepRef)) continue;
                        
                        if (stepInst.status !== 'COMPLETED') continue;

                        // Enforce billing trigger business rules
                        // If no trigger is specified, default to ON_WORK_COMPLETION to prevent premature billing
                        const trigger = step.billing_trigger || 'ON_WORK_COMPLETION';
                        if (trigger === 'ON_WORK_COMPLETION' && work.status !== 'COMPLETED') {
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
                    }
                }
            } 
            
            // Check workflow-level billing
            if (isWorkflowBillable) {
                const workflowRef = exec.id; // Use execution instance ID for uniqueness
                if (billedWorkflowRefs.has(workflowRef)) continue;

                if (exec.status !== 'COMPLETED') continue;

                result.push({
                    id: workflowRef,
                    billable_type: 'WORKFLOW',
                    source_id: exec.id,
                    source_ref: workflowRef,
                    client_id: work.client_id,
                    client_name: client.client_name || 'Unknown Client',
                    work_id: work.id,
                    work_name: work.work_type_name || 'Work',
                    title: tpl?.workflow_name || 'Unknown Workflow',
                    description: 'Full Workflow',
                    professional_fee: 0,
                    government_fee: 0,
                    status: 'READY_TO_BILL'
                });
            }
        }

        return result;
    }
}

class BillableItemProvider {
    constructor() {
        this.taskProvider = new TaskWorkflowProvider();
        this.workProvider = new WorkV2BillingProvider();
    }

    async getBillableWorks(supabase) {
        const tasksResult = await this.taskProvider.getBillableWorks(supabase);
        const worksResult = await this.workProvider.getBillableWorks(supabase);
        
        console.log(`[BILLABLE WORKS] Legacy Tasks: ${tasksResult.length}, V2 Works: ${worksResult.length}`);
        
        return [...tasksResult, ...worksResult];
    }
}

module.exports = new BillableItemProvider();
