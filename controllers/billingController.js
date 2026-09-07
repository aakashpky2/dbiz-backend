const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.getStats = async (req, res) => {
    try {
        const { data: invoices, error } = await supabase.from('billing_invoices')
            .select('status, grand_total, paid_amount, balance_amount')
            .neq('status', 'cancelled');
        if (error) throw error;

        let totalBilledAmount = 0;
        let totalPendingAmount = 0;
        let totalBills = 0;
        let generatedBills = 0;
        let sentBills = 0;
        let partially_paidBills = 0;
        let paidBills = 0;

        invoices.forEach(inv => {
            totalBills++;
            totalBilledAmount += parseFloat(inv.grand_total || 0);
            totalPendingAmount += parseFloat(inv.balance_amount || 0);

            if (inv.status === 'invoice_generated') generatedBills++;
            if (inv.status === 'sent') sentBills++;
            if (inv.status === 'partially_paid') partially_paidBills++;
            if (inv.status === 'paid') paidBills++;
        });

        const { count: cancelledCount } = await supabase.from('billing_invoices')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'cancelled');

        res.json({
            success: true,
            data: {
                totalBilledAmount, totalPendingAmount, totalBills,
                generatedBills, sentBills, partially_paidBills, paidBills,
                cancelledBills: cancelledCount || 0
            }
        });
    } catch (error) {
        console.error('Error fetching billing stats:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInvoices = async (req, res) => {
    try {
        const { data, error } = await supabase.from('billing_invoices').select(`
            id, invoice_no, internal_bill_no, tax_invoice_no, is_tax_invoice, invoice_date, status, grand_total, balance_amount, billing_type,
            snapshot_client_name, snapshot_work_name,
            clients:client_id (client_name),
            tasks:work_id (title)
        `).order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching invoices:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getBillableWorks = async (req, res) => {
    try {
        console.log("==================================================");
        console.log("[BILLABLE WORKS DEBUG] - TASK-BASED ARCHITECTURE");
        console.log("==================================================");

        const billingProvider = require('../services/billingProvider');
        const result = await billingProvider.getBillableWorks(supabase);

        console.log("Final Billable Rows:", result.length);

        console.log("==================================================");
        console.log("BILLABLE WORKS SUMMARY");
        console.log(`Final Billable Rows : ${result.length}`);
        console.log("==================================================");

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error fetching billable works:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getEligibleSteps = async (req, res) => {
    try {
        const { workId } = req.params;
        
        // Check if it's a V2 work first
        let execInstanceId = null;
        const { data: workCheck } = await supabase.from('works').select('id').eq('id', workId).maybeSingle();
        if (workCheck) {
            const { data: execData } = await supabase.from('workflow_execution_instances')
                .select('id').eq('work_id', workId).order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (execData) execInstanceId = execData.id;
        }

        let query = supabase.from('workflow_step_instances').select(`
            id, status, workflow_step_id
        `);
        
        if (execInstanceId) {
            query = query.eq('execution_instance_id', execInstanceId);
        } else {
            // Fallback for older data if it had work_id, though not strictly in V2 schema
            query = query.eq('work_id', workId);
        }
        
        const { data, error } = await query.eq('status', 'COMPLETED');

        if (error) throw error;
        
        const enriched = await Promise.all(data.map(async (step) => {
            const tmplStepId = step.workflow_step_id || step.template_step_id;
            const { data: tmpl } = await supabase.from('workflow_steps').select('step_name, is_billable').eq('id', tmplStepId).maybeSingle();
            return {
                id: step.id,
                step_name: tmpl ? tmpl.step_name : 'Unknown Step',
                status: step.status,
                is_billable: tmpl ? tmpl.is_billable : false
            };
        }));

        res.json({ success: true, data: enriched.filter(s => s.is_billable) });
    } catch (error) {
        console.error('Error fetching eligible steps:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAutofillData = async (req, res) => {
    try {
        const { workId } = req.params;
        const { billable_type, source_ref, source_id } = req.query;

        if (!workId) {
            return res.status(400).json({ success: false, message: 'Missing workId parameter.' });
        }

        // Try to fetch task data directly
        let taskData = null;
        let proposalId = null;

        const { data: task, error: taskErr } = await supabase
            .from('tasks')
            .select(`
                id, title, client_id, work_type_id, workflow_template_id, proposal_id,
                clients:client_id (client_name)
            `)
            .eq('id', workId)
            .maybeSingle();

        if (task) {
            taskData = task;
            proposalId = task.proposal_id;
        } else {
            // Try works
            const { data: workData, error: workErr } = await supabase
                .from('works')
                .select(`
                    id, work_type_name, client_id, proposal_id,
                    clients:client_id (client_name)
                `)
                .eq('id', workId)
                .maybeSingle();
            
            if (workData) {
                // Map work_type_name to title for compatibility with frontend that expects work_title
                workData.title = workData.work_type_name;
                taskData = workData;
                proposalId = workData.proposal_id;
            }
        }

        if (!taskData) {
            return res.status(404).json({ success: false, message: 'Invalid or missing task/work.' });
        }
        
        let prof_fee = 0;
        let govt_fee = 0;
        let autofillAvailable = false;

        if (proposalId) {
            const { data: prop } = await supabase.from('proposals').select('professional_fee, government_fee').eq('id', proposalId).single();
            if (prop) {
                prof_fee = parseFloat(prop.professional_fee || 0);
                govt_fee = parseFloat(prop.government_fee || 0);
                autofillAvailable = true;
            }
        }
        
        if (!autofillAvailable) {
            return res.status(200).json({
                success: true,
                autofillAvailable: false,
                data: null
            });
        }
        
        res.status(200).json({ 
            success: true, 
            autofillAvailable: true,
            data: { 
                client_id: taskData.client_id,
                client_name: taskData.clients?.client_name,
                work_id: taskData.id,
                work_title: taskData.title,
                professional_fee: prof_fee, 
                government_fee: govt_fee,
                billable_type,
                source_ref,
                source_id
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createInvoice = async (req, res) => {
    try {
        const {
            client_id, work_id, billing_type,
            // Unified billing fields
            billable_type, source_id, source_ref,
            // Legacy field kept for backwards compat
            workflow_step_instance_id,
            business_profile_id, invoice_date, due_date, notes, items
        } = req.body;

        // Derive unified fields from legacy if not provided
        const resolvedBillableType = billable_type || (workflow_step_instance_id ? 'STEP' : 'WORKFLOW');
        const resolvedSourceId = source_id || (resolvedBillableType === 'STEP' ? workflow_step_instance_id : null);
        const resolvedSourceRef = source_ref || null;

        if (!work_id) {
            return res.status(400).json({ success: false, message: 'work_id is required and cannot be empty.' });
        }

        if (billable_type && !source_id) {
            return res.status(400).json({ success: false, message: 'source_id is required when billable_type is provided.' });
        }
        
        if (billable_type && !resolvedSourceRef) {
            return res.status(400).json({ success: false, message: 'source_ref is required to prevent duplicate billing.' });
        }

        // Check for duplicate source_ref
        if (resolvedSourceRef) {
            const { data: existingDuplicate } = await supabase
                .from('billing_invoices')
                .select('id')
                .eq('source_type', resolvedBillableType)
                .eq('source_ref', resolvedSourceRef)
                .neq('status', 'cancelled')
                .limit(1);
            
            if (existingDuplicate && existingDuplicate.length > 0) {
                return res.status(400).json({ success: false, message: 'A billing invoice already exists for this workflow or step.' });
            }
        }

        if (resolvedBillableType === 'WORKFLOW' && !resolvedSourceId) {
            return res.status(400).json({ success: false, message: 'Workflow-level billing requires a valid source_id.' });
        }

        const { data: taskCheck, error: taskCheckError } = await supabase.from('tasks').select('id, title').eq('id', work_id).single();
        if (taskCheckError || !taskCheck) {
            return res.status(400).json({ success: false, message: 'Provided work_id (task) does not exist.' });
        }

        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'Line items are required.' });
        }

        // Snapshot Fetch
        const { data: client } = await supabase.from('clients').select('client_name, gst_in, billing_address').eq('id', client_id).single();
        const { data: profile } = await supabase.from('business_profiles').select('profile_name, gstin, address').eq('id', business_profile_id).single();
        
        let step_name = null;
        // For STEP-level billing, fetch step name from the step instance
        const stepInstanceId = resolvedBillableType === 'STEP' ? resolvedSourceId : null;
        if (stepInstanceId) {
            // Note: Since we shifted to task architecture, step instances might not exist.
            // But we can leave this here just in case, or we fetch from workflow_steps directly.
            const { data: step } = await supabase.from('workflow_steps').select('step_name').eq('id', stepInstanceId).single();
            if (step) step_name = step.step_name;
        }

        // Generate Internal Bill Number
        const { data: lastInvoice } = await supabase.from('billing_invoices')
            .select('internal_bill_no')
            .order('created_at', { ascending: false })
            .limit(1);
        
        let nextNumber = 1;
        if (lastInvoice && lastInvoice.length > 0 && lastInvoice[0].internal_bill_no) {
            const match = lastInvoice[0].internal_bill_no.match(/(\d+)$/);
            if (match) nextNumber = parseInt(match[1], 10) + 1;
        }
        const internal_bill_no = `INT-BILL/${new Date().getFullYear()}-${(new Date().getFullYear()+1).toString().slice(2)}/${nextNumber.toString().padStart(3, '0')}`;

        // Calculate totals
        let professional_fee_total = 0;
        let government_fee_total = 0;
        let reimbursement_total = 0;
        let taxable_amount = 0;
        let cgst_amount = 0;
        let sgst_amount = 0;
        let igst_amount = 0;
        let grand_total = 0;

        const calculatedItems = items.map(item => {
            const amount = parseFloat(item.amount || 0);
            const gst_rate = parseFloat(item.gst_rate || 0);
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            
            if (item.fee_type === 'Professional Fee') professional_fee_total += amount;
            else if (item.fee_type === 'Government Fee') government_fee_total += amount;
            else reimbursement_total += amount;

            if (item.gst_applicable) {
                taxable_amount += amount;
                // Simple logic: if GST is applied, calculate
                item_cgst = (amount * (gst_rate / 2)) / 100;
                item_sgst = (amount * (gst_rate / 2)) / 100;
                cgst_amount += item_cgst;
                sgst_amount += item_sgst;
            }

            const item_total = amount + item_cgst + item_sgst + item_igst;
            grand_total += item_total;

            return { ...item, cgst_amount: item_cgst, sgst_amount: item_sgst, igst_amount: item_igst, total_amount: item_total };
        });

        const invoicePayload = {
            internal_bill_no,
            is_tax_invoice: false,
            // Unified billing source
            source_type: resolvedBillableType,
            source_id: resolvedSourceId,
            source_ref: resolvedSourceRef,
            // Legacy field for backwards compat with existing invoices
            workflow_step_instance_id: stepInstanceId,
            client_id, work_id,
            billing_type: billing_type || (resolvedBillableType === 'STEP' ? 'workflow_step' : 'full_work'),
            business_profile_id,
            invoice_date, due_date, notes,
            status: 'draft',
            professional_fee_total, government_fee_total, reimbursement_total,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, grand_total,
            balance_amount: grand_total,
            paid_amount: 0,
            snapshot_client_name: client?.client_name,
            snapshot_client_gstin: client?.gst_in,
            snapshot_client_address: client?.billing_address,
            snapshot_work_name: taskCheck?.title,
            snapshot_step_name: step_name,
            snapshot_profile_name: profile?.profile_name,
            snapshot_profile_gstin: profile?.gstin,
            snapshot_profile_address: profile?.address,
            prepared_by: req.user?.id
        };

        const { data: invoice, error: invErr } = await supabase.from('billing_invoices').insert([invoicePayload]).select().single();
        if (invErr) throw invErr;

        const itemsPayload = calculatedItems.map(item => ({ ...item, invoice_id: invoice.id }));
        const { error: itemsErr } = await supabase.from('billing_invoice_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        res.json({ success: true, data: invoice });
    } catch (error) {
        console.error('Error creating internal bill:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { client_id, work_id, billing_type, workflow_step_instance_id, business_profile_id, invoice_date, due_date, notes, items } = req.body;

        // Check if invoice exists and is editable
        const { data: existingInvoice, error: fetchErr } = await supabase.from('billing_invoices').select('status, is_tax_invoice').eq('id', id).single();
        if (fetchErr || !existingInvoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found.' });
        }
        if (!['draft', 'pending_approval'].includes(existingInvoice.status) || existingInvoice.is_tax_invoice) {
            return res.status(400).json({ success: false, message: 'Only draft internal bills can be edited.' });
        }

        if (!work_id) return res.status(400).json({ success: false, message: 'work_id is required.' });
        if (!items || !items.length) return res.status(400).json({ success: false, message: 'Line items are required.' });

        const { data: taskCheck } = await supabase.from('tasks').select('id, title').eq('id', work_id).single();
        
        // Snapshot Fetch
        const { data: client } = await supabase.from('clients').select('client_name, gst_in, billing_address').eq('id', client_id).single();
        const { data: profile } = await supabase.from('business_profiles').select('profile_name, gstin, address').eq('id', business_profile_id).single();
        
        let step_name = null;
        if (workflow_step_instance_id) {
            const { data: step } = await supabase.from('workflow_step_instances').select('step_name').eq('id', workflow_step_instance_id).single();
            if (step) step_name = step.step_name;
        }

        // Calculate totals
        let professional_fee_total = 0, government_fee_total = 0, reimbursement_total = 0;
        let taxable_amount = 0, cgst_amount = 0, sgst_amount = 0, igst_amount = 0, grand_total = 0;

        const calculatedItems = items.map(item => {
            const amount = parseFloat(item.amount || 0);
            const gst_rate = parseFloat(item.gst_rate || 0);
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            
            if (item.fee_type === 'Professional Fee') professional_fee_total += amount;
            else if (item.fee_type === 'Government Fee') government_fee_total += amount;
            else reimbursement_total += amount;

            if (item.gst_applicable) {
                taxable_amount += amount;
                item_cgst = (amount * (gst_rate / 2)) / 100;
                item_sgst = (amount * (gst_rate / 2)) / 100;
                cgst_amount += item_cgst;
                sgst_amount += item_sgst;
            }

            const item_total = amount + item_cgst + item_sgst + item_igst;
            grand_total += item_total;

            return { ...item, cgst_amount: item_cgst, sgst_amount: item_sgst, igst_amount: item_igst, total_amount: item_total };
        });

        const invoicePayload = {
            client_id, work_id, billing_type, workflow_step_instance_id, business_profile_id,
            invoice_date, due_date, notes,
            professional_fee_total, government_fee_total, reimbursement_total,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, grand_total,
            balance_amount: grand_total,
            snapshot_client_name: client?.client_name,
            snapshot_client_gstin: client?.gst_in,
            snapshot_client_address: client?.billing_address,
            snapshot_work_name: taskCheck?.title,
            snapshot_step_name: step_name,
            snapshot_profile_name: profile?.profile_name,
            snapshot_profile_gstin: profile?.gstin,
            snapshot_profile_address: profile?.address
        };

        const { error: updateErr } = await supabase.from('billing_invoices').update(invoicePayload).eq('id', id);
        if (updateErr) throw updateErr;

        // Replace items
        await supabase.from('billing_invoice_items').delete().eq('invoice_id', id);
        const itemsPayload = calculatedItems.map(item => ({ 
            invoice_id: id, fee_type: item.fee_type, particulars: item.particulars, amount: item.amount, 
            gst_applicable: item.gst_applicable, gst_rate: item.gst_rate, cgst_amount: item.cgst_amount, 
            sgst_amount: item.sgst_amount, igst_amount: item.igst_amount, total_amount: item.total_amount 
        }));
        const { error: itemsErr } = await supabase.from('billing_invoice_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        res.json({ success: true, message: 'Invoice updated successfully.' });
    } catch (error) {
        console.error('Error updating internal bill:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: invoice, error } = await supabase.from('billing_invoices').select(`
            *,
            clients:client_id (client_name),
            tasks:work_id (title),
            items:billing_invoice_items(*),
            payments:billing_payments(*)
        `).eq('id', id).single();

        if (error) throw error;
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

        res.json({ success: true, data: invoice });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.approveInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: invoice, error: invErr } = await supabase.from('billing_invoices').select('status').eq('id', id).single();
        if (invErr) throw invErr;
        if (!['draft', 'pending_approval'].includes(invoice.status)) {
            return res.status(400).json({ success: false, message: 'Bill cannot be approved in its current state.' });
        }
        
        const { error } = await supabase.from('billing_invoices').update({
            status: 'approved',
            approved_by: req.user?.id,
            approved_at: new Date().toISOString()
        }).eq('id', id);
        
        if (error) throw error;
        res.json({ success: true, message: 'Bill approved successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.generateTaxInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: invoice, error: invErr } = await supabase.from('billing_invoices').select('status, is_tax_invoice, tax_invoice_no').eq('id', id).single();
        if (invErr) throw invErr;
        
        if (invoice.status !== 'approved' || invoice.is_tax_invoice) {
            return res.status(400).json({ success: false, message: 'Bill must be approved before generating a tax invoice, and cannot be generated twice.' });
        }

        // Try to allocate from configured Billing Number Series
        let tax_invoice_no = null;
        let billing_number_series_id = null;

        const billingSeriesController = require('./billingSeriesController');
        try {
            const { data: invFull } = await supabase
                .from('billing_invoices')
                .select('*, clients:client_id(constitution_id)')
                .eq('id', id)
                .single();

            const context = {
                business_profile_id: invFull?.business_profile_id,
                client_id: invFull?.client_id,
                work_id: invFull?.work_id,
                constitution_id: invFull?.clients?.constitution_id
            };

            const allocated = await billingSeriesController.allocateNextNumber(context);
            if (allocated) {
                tax_invoice_no = allocated.billing_number;
                billing_number_series_id = allocated.billing_number_series_id;
            }
        } catch (seriesErr) {
            return res.status(409).json({ success: false, message: seriesErr.message });
        }

        // Fallback default generation if no custom series configured
        if (!tax_invoice_no) {
            const { data: lastInvoice } = await supabase.from('billing_invoices')
                .select('tax_invoice_no')
                .eq('is_tax_invoice', true)
                .order('tax_invoice_generated_at', { ascending: false, nullsFirst: false })
                .limit(1);
            
            let nextNumber = 1;
            if (lastInvoice && lastInvoice.length > 0 && lastInvoice[0].tax_invoice_no) {
                const match = lastInvoice[0].tax_invoice_no.match(/(\d+)$/);
                if (match) nextNumber = parseInt(match[1], 10) + 1;
            }
            tax_invoice_no = `DBIZ/${new Date().getFullYear()}-${(new Date().getFullYear()+1).toString().slice(2)}/${nextNumber.toString().padStart(3, '0')}`;
        }

        const { error } = await supabase.from('billing_invoices').update({
            status: 'invoice_generated',
            is_tax_invoice: true,
            tax_invoice_no,
            billing_number_series_id,
            tax_invoice_generated_at: new Date().toISOString()
        }).eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Tax Invoice generated successfully.', data: { tax_invoice_no } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.addPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_date, amount, payment_mode, reference_no, notes } = req.body;
        const payAmount = parseFloat(amount);

        if (isNaN(payAmount) || !Number.isFinite(payAmount) || payAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Payment amount must be a positive number.' });
        }

        const { data: invoice, error: invErr } = await supabase.from('billing_invoices').select('*').eq('id', id).single();
        if (invErr || !invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

        if (!['invoice_generated', 'sent', 'partially_paid'].includes(invoice.status)) {
            return res.status(400).json({ success: false, message: 'Payments can only be added to generated tax invoices.' });
        }

        const currentBalance = Math.round((parseFloat(invoice.balance_amount !== undefined && invoice.balance_amount !== null ? invoice.balance_amount : (parseFloat(invoice.grand_total || 0) - parseFloat(invoice.paid_amount || 0))) + Number.EPSILON) * 100) / 100;
        if (payAmount > currentBalance + 0.001) {
            return res.status(400).json({ success: false, message: `Payment amount (₹${payAmount}) cannot exceed remaining balance amount (₹${currentBalance}).` });
        }

        const { error: payErr } = await supabase.from('billing_payments').insert([{
            invoice_id: id, payment_date, amount: payAmount, payment_mode, reference_no, notes, created_by: req.user?.id
        }]);
        if (payErr) throw payErr;

        const newPaid = Math.round((parseFloat(invoice.paid_amount || 0) + payAmount + Number.EPSILON) * 100) / 100;
        const newBalance = Math.max(0, Math.round((parseFloat(invoice.grand_total) - newPaid + Number.EPSILON) * 100) / 100);
        let newStatus = invoice.status;
        if (newBalance <= 0) newStatus = 'paid';
        else if (newPaid > 0) newStatus = 'partially_paid';

        const { error: updErr } = await supabase.from('billing_invoices').update({
            paid_amount: newPaid, balance_amount: newBalance, status: newStatus,
            paid_at: newBalance <= 0 ? new Date().toISOString() : null
        }).eq('id', id);
        
        if (updErr) throw updErr;
        res.json({ success: true, message: 'Payment added successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.cancelInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { cancellation_reason } = req.body;

        const { data: invoice, error: fetchErr } = await supabase.from('billing_invoices').select('status, paid_amount').eq('id', id).single();
        if (fetchErr || !invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
        if (invoice.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Invoice is already cancelled.' });
        }
        if (invoice.status === 'paid' && parseFloat(invoice.paid_amount || 0) > 0) {
            return res.status(400).json({ success: false, message: 'Paid invoices cannot be cancelled directly.' });
        }

        const { error } = await supabase.from('billing_invoices').update({
            status: 'cancelled', cancellation_reason, cancelled_at: new Date().toISOString(), cancelled_by: req.user?.id
        }).eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Invoice cancelled successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
