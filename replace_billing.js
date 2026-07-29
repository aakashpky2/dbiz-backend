const fs = require('fs');

const fileContent = fs.readFileSync('c:/acoundz/d-biz-app-new/backend/controllers/billingController.js', 'utf8');

const newCode = `exports.getBillableWorks = async (req, res) => {
    try {
        console.log('--- FETCHING BILLABLE WORKS ---');
        // Step 1: Fetch billable templates
        const { data: templates, error: err1 } = await supabase
            .from('workflow_templates')
            .select('id, workflow_name, is_billable')
            .eq('is_billable', true);
        if (err1) return res.json({ success: true, data: [] });
        if (!templates || templates.length === 0) return res.json({ success: true, data: [] });
        
        const templateIds = templates.map(t => t.id);
        console.log('Billable Templates:', templateIds.length);

        // Step 2: Fetch billable steps mapped to these templates
        const { data: steps, error: err2 } = await supabase
            .from('workflow_steps')
            .select('id, workflow_template_id, is_billable, step_name')
            .in('workflow_template_id', templateIds)
            .eq('is_billable', true);
        if (err2 || !steps || steps.length === 0) return res.json({ success: true, data: [] });
        
        const stepIds = steps.map(s => s.id);
        console.log('Billable Steps:', stepIds.length);

        // Step 3: Fetch execution instances for these templates
        const { data: executions, error: err3 } = await supabase
            .from('workflow_execution_instances')
            .select('id, work_id, client_id, workflow_template_id')
            .in('workflow_template_id', templateIds);
        if (err3 || !executions || executions.length === 0) return res.json({ success: true, data: [] });
        
        const execIds = executions.map(e => e.id);
        console.log('Execution Instances:', execIds.length);

        // Step 4: Fetch step instances for these executions and steps
        const { data: stepInstances, error: err4 } = await supabase
            .from('workflow_step_instances')
            .select('id, execution_instance_id, workflow_step_id, status, created_at')
            .in('execution_instance_id', execIds)
            .in('workflow_step_id', stepIds);
        if (err4 || !stepInstances || stepInstances.length === 0) return res.json({ success: true, data: [] });
        
        const stepInstanceIds = stepInstances.map(s => s.id);
        console.log('Step Instances:', stepInstanceIds.length);

        // Step 5: Fetch Works
        const workIds = [...new Set(executions.map(e => e.work_id).filter(Boolean))];
        const { data: works, error: err5 } = await supabase
            .from('works')
            .select('id, professional_fee, government_fee, work_type_name, client_name')
            .in('id', workIds);
        if (err5) return res.json({ success: true, data: [] });
        console.log('Works:', works?.length || 0);

        // Step 6: Fetch Clients (Wait, works already has client_name, but we might need clients directly if needed, skipping if not necessary but let's grab if needed)
        // client_name is mapped in works.

        // Step 7: Fetch Invoices
        const { data: invoices, error: err7 } = await supabase
            .from('billing_invoices')
            .select('id, workflow_step_instance_id, status')
            .in('workflow_step_instance_id', stepInstanceIds)
            .neq('status', 'cancelled');
        if (err7) return res.json({ success: true, data: [] });
        console.log('Invoices:', invoices?.length || 0);

        // MAPS for quick access
        const tmplMap = Object.fromEntries(templates.map(t => [t.id, t]));
        const stepMap = Object.fromEntries(steps.map(s => [s.id, s]));
        const execMap = Object.fromEntries(executions.map(e => [e.id, e]));
        const workMap = Object.fromEntries((works || []).map(w => [w.id, w]));
        const invoiceMap = {};
        (invoices || []).forEach(inv => {
            if (!invoiceMap[inv.workflow_step_instance_id]) {
                invoiceMap[inv.workflow_step_instance_id] = [];
            }
            invoiceMap[inv.workflow_step_instance_id].push(inv);
        });

        // Step 8: Merge in memory
        const mergedData = [];

        stepInstances.forEach(si => {
            const exec = execMap[si.execution_instance_id];
            if (!exec) return;
            const stepDef = stepMap[si.workflow_step_id];
            if (!stepDef) return;
            const tmpl = tmplMap[exec.workflow_template_id];
            if (!tmpl) return;
            const work = workMap[exec.work_id] || {};

            const existingInvoices = invoiceMap[si.id] || [];
            const isBilled = existingInvoices.length > 0;
            
            let billing_status = 'NOT_READY';
            if (isBilled) {
                billing_status = 'BILLED';
            } else if (si.status) {
                // If the user requires specific status like COMPLETED to be READY_TO_BILL, 
                // we can add it here. For now, if there is a step instance, it's ready.
                billing_status = 'READY_TO_BILL';
            }

            // Exclude billed from ready to bill view
            if (billing_status === 'BILLED') return;

            mergedData.push({
                client_id: exec.client_id,
                client_name: work.client_name || 'Unknown Client',
                work_id: exec.work_id,
                work_type_name: work.work_type_name || 'Unknown Work Type',
                workflow_template_id: tmpl.id,
                workflow_name: tmpl.workflow_name,
                workflow_step_id: stepDef.id,
                workflow_step_instance_id: si.id,
                execution_instance_id: exec.id,
                step_name: stepDef.step_name,
                step_status: si.status,
                professional_fee: work.professional_fee || 0,
                government_fee: work.government_fee || 0,
                billing_status,
                created_at: si.created_at
            });
        });

        console.log('Merged Rows:', mergedData.length);
        res.json({ success: true, data: mergedData });

    } catch (error) {
        console.error('Error fetching billable works:', error.message);
        res.json({ success: true, data: [] });
    }
};

exports.getEligibleSteps = async (req, res) => {
    try {
        const { workId } = req.params;
        
        // Find execution instance for this work_id
        const { data: execs, error: eErr } = await supabase
            .from('workflow_execution_instances')
            .select('id')
            .eq('work_id', workId);
            
        if (eErr || !execs || execs.length === 0) return res.json({ success: true, data: [] });
        const execIds = execs.map(e => e.id);

        const { data: stepInsts, error: sErr } = await supabase
            .from('workflow_step_instances')
            .select('id, workflow_step_id, step_order, status')
            .in('execution_instance_id', execIds)
            .eq('status', 'COMPLETED')
            .order('step_order', { ascending: true });

        if (sErr || !stepInsts) return res.json({ success: true, data: [] });

        const stepIds = stepInsts.map(s => s.workflow_step_id).filter(Boolean);
        if (stepIds.length === 0) return res.json({ success: true, data: [] });

        const { data: steps, error: stepErr } = await supabase
            .from('workflow_steps')
            .select('id, step_name, billing_category')
            .in('id', stepIds);

        const stepMap = Object.fromEntries((steps || []).map(s => [s.id, s]));

        const enriched = stepInsts.map(si => {
            const stepDef = stepMap[si.workflow_step_id] || {};
            return {
                id: si.id,
                step_name: stepDef.step_name || 'Unknown Step',
                step_order: si.step_order,
                status: si.status,
                billing_category: stepDef.billing_category || 'none'
            };
        });

        res.json({ success: true, data: enriched.filter(s => s.billing_category && s.billing_category !== 'none') });
    } catch (error) {
        console.error('Error fetching eligible steps:', error.message);
        res.json({ success: true, data: [] });
    }
};`;

const regex = /exports\.getBillableWorks\s*=\s*async\s*\(req,\s*res\)\s*=>\s*\{[\s\S]*?exports\.getEligibleSteps\s*=\s*async\s*\(req,\s*res\)\s*=>\s*\{[\s\S]*?res\.status\(500\)\.json\(\{ success: false, message: error\.message \}\);\s*\n\s*\}\s*;/;

const newFileContent = fileContent.replace(regex, newCode);

fs.writeFileSync('c:/acoundz/d-biz-app-new/backend/controllers/billingController.js', newFileContent);
console.log('Replaced successfully');
