const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------

/** Remove keys with undefined values from a payload object before DB operations */
function cleanUndefined(obj) {
    Object.keys(obj).forEach(k => obj[k] === undefined && delete obj[k]);
    return obj;
}

// -------------------------------------------------------------
// STAGES
// -------------------------------------------------------------
router.get('/stages', requirePermission('VIEW_DSC'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dsc_workflow_stages')
            .select('*')
            .eq('is_deleted', false)
            .order('order', { ascending: true });

        if (error) throw error;

        const stages = data.map(s => ({
            id: s.id,
            name: s.name,
            order: s.order,
            description: s.description,
            completionPercentage: s.completion_percentage,
            checklistItems: s.checklist_items,
            requiredFields: s.required_fields,
            documents: s.documents,
            isDeleted: s.is_deleted
        }));

        res.json(stages);
    } catch (err) {
        console.error('[DSC] GET /stages error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------------------------------------------------
// MASTERS CONFIG
// -------------------------------------------------------------
router.get('/masters', requirePermission('VIEW_DSC'), async (req, res) => {
    try {
        const [cls, typ, val, auth, rates] = await Promise.all([
            supabase.from('dsc_classes').select('*'),
            supabase.from('dsc_types').select('*'),
            supabase.from('dsc_validities').select('*'),
            supabase.from('dsc_authorities').select('*'),
            supabase.from('dsc_rates').select('*')
        ]);

        // Check each query individually — do not silently return [] on error
        if (cls.error) throw new Error(`dsc_classes: ${cls.error.message}`);
        if (typ.error) throw new Error(`dsc_types: ${typ.error.message}`);
        if (val.error) throw new Error(`dsc_validities: ${val.error.message}`);
        if (auth.error) throw new Error(`dsc_authorities: ${auth.error.message}`);
        if (rates.error) throw new Error(`dsc_rates: ${rates.error.message}`);

        res.json({
            cls: cls.data || [],
            typ: typ.data || [],
            val: val.data || [],
            auth: auth.data || [],
            rates: rates.data || []
        });
    } catch (err) {
        console.error('[DSC] GET /masters error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------------------------------------------------
// DSCS
// -------------------------------------------------------------
router.get('/', requirePermission('VIEW_DSC'), async (req, res) => {
    try {
        const { data, error } = await supabase.from('dscs').select('*');
        if (error) throw error;

        const dscs = data.map(d => ({
            id: d.id,
            companyName: d.company_name,
            issueDate: d.issue_date,
            validityYears: d.validity_years,
            expiryDate: d.expiry_date,
            status: d.status,
            remarks: d.remarks,
            currentStatus: d.current_status,
            currentHolder: d.current_holder,
            type: d.type,
            mobile: d.mobile,
            email: d.email,
            pan: d.pan,
            aadhar: d.aadhar,
            applicationDate: d.application_date,
            expectedDeliveryDays: d.expected_delivery_days,
            currentStageId: d.current_stage_id,
            stageHistory: d.stage_history,
            dscPassword: d.dsc_password,
            tokenDefaultPassword: d.token_default_password,
            tokenChangedPassword: d.token_changed_password,
            tokenPasswordChangeDate: d.token_password_change_date,
            phone: d.phone,
            designation: d.designation,
            verificationStatus: d.verification_status,
            kycStatus: d.kyc_status,
            paymentStatus: d.payment_status,
            paymentAmount: d.payment_amount,
            paidAmount: d.paid_amount,
            courierPartner: d.courier_partner,
            trackingId: d.tracking_id,
            followups: d.followups,
            createdAt: d.created_at,
            updatedAt: d.updated_at
        }));

        res.json(dscs);
    } catch (err) {
        console.error('[DSC] GET / error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/', requirePermission('MANAGE_DSC'), async (req, res) => {
    try {
        const payload = req.body;

        // Validate required fields
        if (!payload.companyName || !payload.type) {
            return res.status(400).json({ error: 'Company name and DSC type are required.' });
        }

        const dbPayload = cleanUndefined({
            company_name: payload.companyName,
            issue_date: payload.issueDate,
            validity_years: payload.validityYears,
            expiry_date: payload.expiryDate,
            status: payload.status,
            remarks: payload.remarks,
            current_status: payload.currentStatus || 'IN',
            current_holder: payload.currentHolder,
            type: payload.type,
            mobile: payload.mobile,
            email: payload.email,
            pan: payload.pan,
            aadhar: payload.aadhar,
            application_date: payload.applicationDate,
            expected_delivery_days: payload.expectedDeliveryDays,
            current_stage_id: payload.currentStageId,
            stage_history: payload.stageHistory,
            dsc_password: payload.dscPassword,
            token_default_password: payload.tokenDefaultPassword,
            token_changed_password: payload.tokenChangedPassword,
            token_password_change_date: payload.tokenPasswordChangeDate,
            phone: payload.phone,
            designation: payload.designation,
            verification_status: payload.verificationStatus,
            kyc_status: payload.kycStatus,
            payment_status: payload.paymentStatus,
            payment_amount: payload.paymentAmount,
            paid_amount: payload.paidAmount,
            courier_partner: payload.courierPartner,
            tracking_id: payload.trackingId,
            followups: payload.followups
        });

        const { data, error } = await supabase.from('dscs').insert(dbPayload).select().single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (err) {
        console.error('[DSC] POST / error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', requirePermission('MANAGE_DSC'), async (req, res) => {
    try {
        const { id } = req.params;
        const payload = req.body;

        const dbPayload = cleanUndefined({
            company_name: payload.companyName,
            issue_date: payload.issueDate,
            validity_years: payload.validityYears,
            expiry_date: payload.expiryDate,
            status: payload.status,
            remarks: payload.remarks,
            current_status: payload.currentStatus,
            current_holder: payload.currentHolder,
            type: payload.type,
            mobile: payload.mobile,
            email: payload.email,
            pan: payload.pan,
            aadhar: payload.aadhar,
            application_date: payload.applicationDate,
            expected_delivery_days: payload.expectedDeliveryDays,
            current_stage_id: payload.currentStageId,
            stage_history: payload.stageHistory,
            dsc_password: payload.dscPassword,
            token_default_password: payload.tokenDefaultPassword,
            token_changed_password: payload.tokenChangedPassword,
            token_password_change_date: payload.tokenPasswordChangeDate,
            phone: payload.phone,
            designation: payload.designation,
            verification_status: payload.verificationStatus,
            kyc_status: payload.kycStatus,
            payment_status: payload.paymentStatus,
            payment_amount: payload.paymentAmount,
            paid_amount: payload.paidAmount,
            courier_partner: payload.courierPartner,
            tracking_id: payload.trackingId,
            followups: payload.followups,
            updated_at: new Date().toISOString()
        });

        const { data, error } = await supabase.from('dscs').update(dbPayload).eq('id', id).select().single();
        if (error) throw error;

        res.json(data);
    } catch (err) {
        console.error('[DSC] PUT /:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------------------------------------------------
// LINKS & MOVEMENTS
// -------------------------------------------------------------
router.post('/links', requirePermission('MANAGE_DSC'), async (req, res) => {
    try {
        const payload = req.body;

        // Validate required fields
        if (!payload.dscId || !payload.clientId || !payload.roleKey || !payload.memberId) {
            return res.status(400).json({ error: 'dscId, clientId, roleKey, and memberId are required.' });
        }

        // Duplicate prevention — check for existing active link
        const { data: existing, error: checkError } = await supabase
            .from('dsc_links')
            .select('id')
            .eq('dsc_id', payload.dscId)
            .eq('client_id', payload.clientId)
            .eq('role_key', payload.roleKey)
            .eq('member_id', payload.memberId)
            .eq('is_active', true)
            .limit(1);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            return res.status(409).json({ error: 'An active link already exists for this DSC, client, and member.' });
        }

        const dbPayload = {
            dsc_id: payload.dscId,
            client_id: payload.clientId,
            role_key: payload.roleKey,
            member_id: payload.memberId,
            remarks: payload.remarks,
            is_active: payload.isActive
        };

        const { data, error } = await supabase.from('dsc_links').insert(dbPayload).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error('[DSC] POST /links error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/movements', requirePermission('MANAGE_DSC'), async (req, res) => {
    try {
        const payload = req.body;

        // Validate required fields
        if (!payload.dscId || !payload.movementType) {
            return res.status(400).json({ error: 'dscId and movementType are required.' });
        }

        const dbPayload = {
            dsc_id: payload.dscId,
            movement_type: payload.movementType,
            movement_date: payload.movementDate,
            client_id: payload.clientId,
            role_key: payload.roleKey,
            member_id: payload.memberId,
            remarks: payload.remarks
        };

        const { data, error } = await supabase.from('dsc_movements').insert(dbPayload).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error('[DSC] POST /movements error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
