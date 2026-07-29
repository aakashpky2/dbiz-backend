const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { requirePermission } = require('../lib/permissions');
const { authenticateToken } = require('./auth');

async function fetchEmployeeContext(req) {
    const authUserId = req.user?.id || req.user?.uid;
    if (!authUserId) return null;
    const { data: emp } = await supabase.from('employees').select('id, full_name, first_name, last_name').eq('auth_user_id', authUserId).maybeSingle();
    return emp ? { authUserId, employee: { firstName: emp.first_name || emp.full_name, lastName: emp.last_name || '' } } : null;
}

// Helper to validate and derive names from Master Data
async function validateAndDeriveMasterData(worksArray) {
    if (!Array.isArray(worksArray) || worksArray.length === 0) {
        throw new Error('Works must be a non-empty array');
    }

    const clientIds = [...new Set(worksArray.map(w => w.client_id).filter(Boolean))];
    const deptIds = [...new Set(worksArray.map(w => w.department_id).filter(Boolean))];
    const catIds = [...new Set(worksArray.map(w => w.category_id).filter(Boolean))];
    const workTypeIds = [...new Set(worksArray.map(w => w.work_type_id).filter(Boolean))];

    // Fetch related records in batch
    const [
        { data: clients },
        { data: depts },
        { data: categories },
        { data: workTypes }
    ] = await Promise.all([
        supabase.from('clients').select('id, client_name').in('id', clientIds),
        supabase.from('departments').select('id, name').in('id', deptIds),
        supabase.from('worktype_categories').select('id, name').in('id', catIds),
        supabase.from('worktype_master').select('id, name').in('id', workTypeIds)
    ]);

    const clientMap = new Map((clients || []).map(c => [c.id, c.client_name]));
    const deptMap = new Map((depts || []).map(d => [d.id, d.name]));
    const catMap = new Map((categories || []).map(c => [c.id, c.name]));
    const wtMap = new Map((workTypes || []).map(wt => [wt.id, wt.name]));

    // Validate and patch names
    const validatedWorks = worksArray.map((work, idx) => {
        if (!work.client_id || !clientMap.has(work.client_id)) {
            throw new Error(`Invalid or missing client_id at index ${idx}`);
        }
        if (!work.department_id || !deptMap.has(work.department_id)) {
            throw new Error(`Invalid or missing department_id at index ${idx}`);
        }
        if (!work.category_id || !catMap.has(work.category_id)) {
            throw new Error(`Invalid or missing category_id at index ${idx}`);
        }
        if (!work.work_type_id || !wtMap.has(work.work_type_id)) {
            throw new Error(`Invalid or missing work_type_id at index ${idx}`);
        }
        
        const status = ['Not Started', 'COMPLETED'].includes(work.status) ? work.status : 'Not Started';

        return {
            ...work,
            client_name: clientMap.get(work.client_id),
            department_name: deptMap.get(work.department_id),
            category_name: catMap.get(work.category_id),
            work_type_name: wtMap.get(work.work_type_id),
            status: status
        };
    });

    return validatedWorks;
}

// Map frontend payload to DB schema
const mapToDbSchema = (w) => ({
    client_id: w.clientId || w.client_id,
    department_id: w.departmentId || w.department_id,
    category_id: w.categoryId || w.category_id,
    work_type_id: w.workTypeId || w.work_type_id,
    client_name: w.clientName || w.client_name,
    department_name: w.departmentName || w.department_name,
    category_name: w.categoryName || w.category_name,
    work_type_name: w.workTypeName || w.work_type_name,
    work_type_status: w.workTypeStatus || w.work_type_status || 'ACTIVE',
    occurrence: w.occurrence,
    financial_year: w.financialYear || w.financial_year,
    period: w.period,
    priority: w.priority || 'Medium',
    reference_type: w.referenceType || w.reference_type || 'Direct',
    associate_id: w.associateId || w.associate_id,
    associate_name: w.associateName || w.associate_name,
    associate_effective_date: w.associateEffectiveDate || w.associate_effective_date,
    due_date: w.dueDate || w.due_date,
    finish_by_date: w.finishByDate || w.finish_by_date,
    finish_by_time: w.finishByTime || w.finish_by_time,
    duration_days: w.durationDays || w.duration_days || 0,
    duration_hours: w.durationHours || w.duration_hours || 0,
    status: w.status || 'Not Started',
    entered_date: w.entryDate || w.entered_date,
    entered_time: w.entered_time || (new Date().toISOString().split('T')[1].split('.')[0]),
    remarks: w.remarks,
    proposal_id: w.proposalId || w.proposal_id,
    professional_fee: w.professionalFee || w.professional_fee || 0,
    government_fee: w.governmentFee || w.government_fee || 0,
    gst_percentage: w.gstPercentage || w.gst_percentage || 18,
    gst_amount: w.gstAmount || w.gst_amount || 0,
    total_amount: w.totalAmount || w.total_amount || 0,
    pending_order: w.status === 'Pending' ? (w.pendingOrder || w.pending_order) : null,
});

router.post('/', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { works } = req.body;
        if (!works || !Array.isArray(works)) {
            return res.status(400).json({ success: false, error: 'Invalid payload: expected { works: [...] }' });
        }

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) {
            return res.status(403).json({ success: false, error: 'Unauthorized: No employee context' });
        }

        const authUserId = employeeCtx.authUserId; // The UUID from auth.users
        const actorName = employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : '');

        // Map payload
        const mappedWorks = works.map(mapToDbSchema);

        // Validate IDs and inject authoritative names
        const validatedWorks = await validateAndDeriveMasterData(mappedWorks);

        // Execute Transaction via RPC
        const { data, error } = await supabase.rpc('create_works_with_tracking', {
            p_works: validatedWorks,
            p_actor_auth_user_id: authUserId,
            p_actor_name: actorName
        });

        if (error) {
            console.error('[POST /api/works] RPC Error:', error);
            const status = error.code && error.code.startsWith('23') ? 422 : 500;
            return res.status(status).json({ success: false, error: error.message || 'Transaction failed' });
        }

        res.json({ success: true, data: { works: data } });

    } catch (err) {
        console.error('[POST /api/works] Error:', err);
        const status = err.message.includes('Invalid or missing') ? 404 : 500;
        res.status(status).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});

router.patch('/:id', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'Empty update payload' });
        }

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) {
            return res.status(403).json({ success: false, error: 'Unauthorized: No employee context' });
        }

        const authUserId = employeeCtx.authUserId; 
        const actorName = employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : '');

        // Map frontend fields to db fields if they sent camelCase
        const dbUpdates = mapToDbSchema(updates);

        const { data, error } = await supabase.rpc('update_work_with_tracking', {
            p_work_id: id,
            p_updates: dbUpdates,
            p_actor_auth_user_id: authUserId,
            p_actor_name: actorName
        });

        if (error) {
            console.error('[PATCH /api/works] RPC Error:', error);
            return res.status(500).json({ success: false, error: error.message || 'Transaction failed' });
        }

        res.json({ success: true, data: data });

    } catch (err) {
        console.error('[PATCH /api/works] Error:', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});

module.exports = router;
