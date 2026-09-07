const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { requirePermission } = require('../lib/permissions');
const { authenticateToken } = require('./auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (val) => typeof val === 'string' && UUID_REGEX.test(val);

const normalizeOptionalUUID = (val) => {
    if (val === undefined || val === null || val === '') return null;
    return val;
};

class ValidationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ValidationError';
        this.status = status;
        this.isValidation = true;
    }
}

async function fetchEmployeeContext(req) {
    const authUserId = req.user?.id || req.user?.uid;
    if (!authUserId) return null;

    try {
        const { data: profile, error: profErr } = await supabase
            .from('user_profiles')
            .select('full_name, email')
            .eq('uid', authUserId)
            .maybeSingle();

        if (profErr) {
            console.error('[fetchEmployeeContext] Warning querying user_profiles:', profErr);
        }

        const name = profile?.full_name || req.user?.user_metadata?.full_name || req.user?.email || 'System User';
        return {
            authUserId,
            employee: {
                firstName: name,
                lastName: ''
            }
        };
    } catch (err) {
        console.error('[fetchEmployeeContext] Error:', err);
        return {
            authUserId,
            employee: {
                firstName: req.user?.email || 'System User',
                lastName: ''
            }
        };
    }
}


// Helper to validate and derive names from Master Data
async function validateAndDeriveMasterData(worksArray, requestId) {
    if (!Array.isArray(worksArray) || worksArray.length === 0) {
        throw new ValidationError('Works must be a non-empty array');
    }

    // 1. Validate required UUID formats
    for (let idx = 0; idx < worksArray.length; idx++) {
        const work = worksArray[idx];
        const entryNum = idx + 1;

        if (!work.client_id) {
            throw new ValidationError(`Client is required (entry ${entryNum})`);
        }
        if (!isValidUUID(work.client_id)) {
            throw new ValidationError(`Invalid client_id format (entry ${entryNum})`);
        }

        if (!work.department_id) {
            throw new ValidationError(`Department is required (entry ${entryNum})`);
        }
        if (!isValidUUID(work.department_id)) {
            throw new ValidationError(`Invalid department_id format (entry ${entryNum})`);
        }

        if (!work.category_id) {
            throw new ValidationError(`Category is required (entry ${entryNum})`);
        }
        if (!isValidUUID(work.category_id)) {
            throw new ValidationError(`Invalid category_id format (entry ${entryNum})`);
        }

        if (!work.work_type_id) {
            throw new ValidationError(`Work Type is required (entry ${entryNum})`);
        }
        if (!isValidUUID(work.work_type_id)) {
            throw new ValidationError(`Invalid work_type_id format (entry ${entryNum})`);
        }

        if (work.associate_id && !isValidUUID(work.associate_id)) {
            throw new ValidationError(`Invalid associate_id format (entry ${entryNum})`);
        }

        if (work.proposal_id && !isValidUUID(work.proposal_id)) {
            throw new ValidationError(`Invalid proposal_id format (entry ${entryNum})`);
        }
    }

    const clientIds = [...new Set(worksArray.map(w => w.client_id).filter(Boolean))];
    const deptIds = [...new Set(worksArray.map(w => w.department_id).filter(Boolean))];
    const catIds = [...new Set(worksArray.map(w => w.category_id).filter(Boolean))];
    const workTypeIds = [...new Set(worksArray.map(w => w.work_type_id).filter(Boolean))];

    // 2. Fetch related records in batch from correct tables
    const [
        { data: clients, error: clientErr },
        { data: depts, error: deptErr },
        { data: categories, error: catErr },
        { data: workTypes, error: wtErr }
    ] = await Promise.all([
        supabase.from('clients').select('id, client_name').in('id', clientIds),
        supabase.from('department_master').select('id, department_name').in('id', deptIds),
        supabase.from('category_master').select('id, category_name, department_id').in('id', catIds),
        supabase.from('worktype_master').select('id, work_type_name, category_id, department_id').in('id', workTypeIds)
    ]);

    if (clientErr || deptErr || catErr || wtErr) {
        console.error('[validateAndDeriveMasterData] Master lookup failed:', {
            requestId,
            clientErr: clientErr?.message,
            deptErr: deptErr?.message,
            catErr: catErr?.message,
            wtErr: wtErr?.message
        });
        const dbErr = new Error('Failed to validate master data references');
        dbErr.status = 500;
        throw dbErr;
    }

    const clientMap = new Map((clients || []).map(c => [c.id, c.client_name]));
    const deptMap = new Map((depts || []).map(d => [d.id, d.department_name]));
    const catMap = new Map((categories || []).map(c => [c.id, c]));
    const wtMap = new Map((workTypes || []).map(wt => [wt.id, wt]));

    // 3. Validate existence and relationships
    const validatedWorks = worksArray.map((work, idx) => {
        const entryNum = idx + 1;

        if (!clientMap.has(work.client_id)) {
            throw new ValidationError(`Client not found (entry ${entryNum})`, 400);
        }
        if (!deptMap.has(work.department_id)) {
            throw new ValidationError(`Department not found (entry ${entryNum})`, 400);
        }
        if (!catMap.has(work.category_id)) {
            throw new ValidationError(`Category not found (entry ${entryNum})`, 400);
        }
        if (!wtMap.has(work.work_type_id)) {
            throw new ValidationError(`Work Type not found (entry ${entryNum})`, 400);
        }

        const catObj = catMap.get(work.category_id);
        const wtObj = wtMap.get(work.work_type_id);

        // Validate relationship: category must belong to the department
        if (catObj.department_id && catObj.department_id !== work.department_id) {
            throw new ValidationError(`Category "${catObj.category_name}" does not belong to the selected department (entry ${entryNum})`, 400);
        }

        // Validate relationship: work type must belong to the category
        if (wtObj.category_id && wtObj.category_id !== work.category_id) {
            throw new ValidationError(`Work Type "${wtObj.work_type_name}" does not belong to the selected category (entry ${entryNum})`, 400);
        }

        const validStatuses = ['Not Started', 'Pending', 'In Progress', 'COMPLETED', 'Cancelled', 'On Hold'];
        const status = validStatuses.includes(work.status) ? work.status : 'Not Started';

        return {
            ...work,
            client_name: clientMap.get(work.client_id),
            department_name: deptMap.get(work.department_id),
            category_name: catObj.category_name,
            work_type_name: wtObj.work_type_name,
            status: status
        };
    });

    return validatedWorks;
}

// Map frontend payload to DB schema
const mapToDbSchema = (w) => ({
    client_id: normalizeOptionalUUID(w.clientId || w.client_id),
    department_id: normalizeOptionalUUID(w.departmentId || w.department_id),
    category_id: normalizeOptionalUUID(w.categoryId || w.category_id),
    work_type_id: normalizeOptionalUUID(w.workTypeId || w.work_type_id),
    client_name: w.clientName || w.client_name || null,
    department_name: w.departmentName || w.department_name || null,
    category_name: w.categoryName || w.category_name || null,
    work_type_name: w.workTypeName || w.work_type_name || null,
    work_type_status: w.workTypeStatus || w.work_type_status || 'ACTIVE',
    occurrence: w.occurrence || 'Monthly',
    financial_year: w.financialYear || w.financial_year || null,
    period: w.period || null,
    priority: w.priority || 'Medium',
    reference_type: w.referenceType || w.reference_type || 'Direct',
    associate_id: normalizeOptionalUUID(w.associateId || w.associate_id),
    associate_name: w.associateName || w.associate_name || null,
    associate_effective_date: (w.associateEffectiveDate || w.associate_effective_date) ? (w.associateEffectiveDate || w.associate_effective_date) : null,
    due_date: (w.dueDate || w.due_date) ? (w.dueDate || w.due_date) : null,
    finish_by_date: (w.finishByDate || w.finish_by_date) ? (w.finishByDate || w.finish_by_date) : null,
    finish_by_time: (w.finishByTime || w.finish_by_time) ? (w.finishByTime || w.finish_by_time) : null,
    duration_days: Number(w.durationDays || w.duration_days) || 0,
    duration_hours: Number(w.durationHours || w.duration_hours) || 0,
    status: w.status || 'Not Started',
    entered_date: (w.entryDate || w.entered_date) ? (w.entryDate || w.entered_date) : null,
    entered_time: w.entered_time || (new Date().toISOString().split('T')[1].split('.')[0]),
    remarks: w.remarks || null,
    proposal_id: normalizeOptionalUUID(w.proposalId || w.proposal_id),
    professional_fee: Number(w.professionalFee || w.professional_fee) || 0,
    government_fee: Number(w.governmentFee || w.government_fee) || 0,
    gst_percentage: Number(w.gstPercentage !== undefined ? w.gstPercentage : (w.gst_percentage !== undefined ? w.gst_percentage : 18)),
    gst_amount: Number(w.gstAmount || w.gst_amount) || 0,
    total_amount: Number(w.totalAmount || w.total_amount) || 0,
    pending_order: w.status === 'Pending' ? (w.pendingOrder !== undefined ? w.pendingOrder : w.pending_order) : null,
    workflow_status: w.workflow_status || 'AVAILABLE',
    assignment_status: w.assignment_status || 'UNASSIGNED',
});

router.post('/', requirePermission('MANAGE_WORKS'), async (req, res) => {
    const requestId = req.requestId || req.headers['x-dbiz-request-id'] || 'unknown';
    try {
        let works = req.body?.works;
        if (!works && Array.isArray(req.body)) {
            works = req.body;
        } else if (!works && req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
            works = [req.body];
        }

        if (!works || !Array.isArray(works) || works.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid payload: expected non-empty works array or work object' });
        }

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) {
            return res.status(403).json({ success: false, error: 'Unauthorized: No employee context' });
        }

        const authUserId = employeeCtx.authUserId; // The UUID from auth.users / user_profiles
        const actorName = employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : '');

        // Map payload to clean DB schema representation
        const mappedWorks = works.map(mapToDbSchema);

        // Validate IDs, verify relationships, and inject authoritative master data names
        const validatedWorks = await validateAndDeriveMasterData(mappedWorks, requestId);

        // Prepare insert rows with entered_by and entered_by_name
        const insertRows = validatedWorks.map(w => ({
            ...w,
            entered_by: authUserId,
            entered_by_name: actorName
        }));

        // Execute direct table insert into public.works
        const { data: insertedWorks, error: insertError } = await supabase
            .from('works')
            .insert(insertRows)
            .select();

        if (insertError) {
            console.error('[POST /api/works] Insert Error:', {
                requestId,
                code: insertError.code,
                message: insertError.message,
                details: insertError.details,
                hint: insertError.hint
            });
            return res.status(500).json({ success: false, error: 'Unable to create work' });
        }

        // Insert audit tracking rows
        if (insertedWorks && insertedWorks.length > 0) {
            const trackingEntries = insertedWorks.map(w => ({
                work_id: w.id,
                type: 'CREATED',
                by: actorName,
                uid: authUserId,
                at: new Date().toISOString(),
                status: w.status
            }));
            const { error: trackError } = await supabase
                .from('work_tracking')
                .insert(trackingEntries);

            if (trackError) {
                console.warn('[POST /api/works] Work tracking log warning:', trackError);
            }
        }

        return res.status(201).json({ success: true, data: { works: insertedWorks } });

    } catch (err) {
        console.error('[POST /api/works] Error:', { requestId, message: err.message, status: err.status });
        const status = err.status || (err.isValidation ? 400 : 500);
        const errorMessage = status === 500 ? 'Unable to create work' : (err.message || 'Validation failed');
        return res.status(status).json({ success: false, error: errorMessage });
    }
});

router.patch('/:id', requirePermission('MANAGE_WORKS'), async (req, res) => {
    const requestId = req.requestId || req.headers['x-dbiz-request-id'] || 'unknown';
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ success: false, error: 'Invalid work id format' });
        }

        if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
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

        // Filter out undefined values
        const filteredUpdates = {};
        for (const [key, value] of Object.entries(dbUpdates)) {
            if (value !== undefined) {
                filteredUpdates[key] = value;
            }
        }

        const { data: updatedWork, error: updateError } = await supabase
            .from('works')
            .update(filteredUpdates)
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            console.error('[PATCH /api/works] Update Error:', {
                requestId,
                code: updateError.code,
                message: updateError.message,
                details: updateError.details,
                hint: updateError.hint
            });
            return res.status(500).json({ success: false, error: 'Unable to update work' });
        }

        // Insert audit tracking row
        if (updatedWork) {
            const { error: trackError } = await supabase
                .from('work_tracking')
                .insert([{
                    work_id: updatedWork.id,
                    type: 'UPDATED',
                    by: actorName,
                    uid: authUserId,
                    at: new Date().toISOString(),
                    status: updatedWork.status
                }]);

            if (trackError) {
                console.warn('[PATCH /api/works] Work tracking update warning:', trackError);
            }
        }

        return res.status(200).json({ success: true, data: updatedWork });

    } catch (err) {
        console.error('[PATCH /api/works] Error:', { requestId, message: err.message });
        return res.status(500).json({ success: false, error: 'Unable to update work' });
    }
});

module.exports = router;
