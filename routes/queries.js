const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const {
    parsePhoneNumber,
    normalizeDialCode,
    normalizeContactsArray,
    normalizeEnquiryContacts,
} = require('../lib/phone');

/**
 * Normalized Query Formatter
 */
const formatQuery = (q) => {
    if (!q) return null;
    return {
        id: q.id,
        clientId: q.client_id,
        profileId: q.profile_id || null,
        contactId: q.contact_id || null,
        companyName: q.company_name || '',
        contactPerson: q.contact_person || '',
        contactNumber: q.contact_number || '',
        contactCountryCode: q.contact_country_code || '+91',
        emailId: q.email_id || '',
        companyPhone: q.company_phone || '',
        companyEmail: q.company_email || '',
        address: q.address || '',
        position: q.position || '',
        remarks: q.remarks || '',
        queryDetails: q.query_details || '',
        workItems: Array.isArray(q.work_items) ? q.work_items : [],
        enquiryContacts: Array.isArray(q.enquiry_contacts) ? q.enquiry_contacts : [],
        status: q.status || 'Open',
        createdBy: q.created_by,
        createdByName: q.created_by_name || 'Unknown',
        createdAt: q.created_at ? new Date(q.created_at).getTime() : Date.now(),
        updatedAt: q.updated_at ? new Date(q.updated_at).getTime() : null,
        clientType: q.client_id ? 'existing' : (q.temporary_client_id ? 'new' : 'existing'),
        temporaryClientId: q.temporary_client_id || null
    };
};

// GET /api/queries
router.get('/', async (req, res) => {
    try {
        let { fields, page = 1, limit = 5, search = '', status = '', profileId = '' } = req.query;
        
        page = Math.max(1, parseInt(page) || 1);
        limit = Math.max(1, parseInt(limit) || 5);
        const offset = (page - 1) * limit;

        let queryBuilder = supabase
            .from('queries')
            .select('*', { count: 'exact' });

        if (status) {
            if (status === 'Closed') {
                queryBuilder = queryBuilder.in('status', ['Closed', 'Resolved', 'Proposal Generated', 'Dropped']);
            } else {
                queryBuilder = queryBuilder.eq('status', status);
            }
        }
        if (profileId) queryBuilder = queryBuilder.eq('profile_id', profileId);

        if (search) {
            queryBuilder = queryBuilder.or(`company_name.ilike.%${search}%,contact_person.ilike.%${search}%,contact_number.ilike.%${search}%,email_id.ilike.%${search}%`);
        }

        const { data, count, error } = await queryBuilder
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Queries API] Fetch list error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        // Stats for tabs
        let stats = { open: 0, working: 0, closed: 0 };
        try {
            const { data: statsData, error: statsError } = await supabase.from('queries').select('status');
            if (!statsError && statsData) {
                stats = {
                    open: statsData.filter(q => q.status === 'Open').length,
                    working: statsData.filter(q => q.status === 'Working').length,
                    closed: statsData.filter(q => ['Closed', 'Resolved', 'Proposal Generated', 'Dropped'].includes(q.status)).length
                };
            }
        } catch (sErr) {
            console.error('[Queries API] Stats error:', sErr);
        }

        res.json({
            success: true,
            data: (data || []).map(formatQuery),
            stats,
            pagination: {
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit) || 1
            }
        });
    } catch (error) {
        console.error('[Queries API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/queries/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('queries')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Query not found' });
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, data: formatQuery(data) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/queries
router.post('/', async (req, res) => {
    try {
        const queryData = req.body;

        // ── Normalize main contact phone ──────────────────────────────────────
        const { countryCode: normalizedCountryCode, phone: mainPhone } = parsePhoneNumber(
            queryData.contactNumber,
            queryData.contactCountryCode || '+91'
        );

        // ── Normalize enquiry contacts ────────────────────────────────────────
        const normalizedContacts = normalizeEnquiryContacts(queryData.enquiryContacts);

        let tempClientId = null;

        // 1. Handle New Client Flow (Create prospective entry)
        if (queryData.clientType === 'new') {
            const { data: tempClient, error: tempError } = await supabase
                .from('temporary_clients')
                .insert({
                    company_name: queryData.companyName || 'New Lead',
                    contact_person: queryData.contactPerson,
                    contact_number: mainPhone || queryData.contactNumber || '',
                    contact_country_code: normalizedCountryCode,
                    email_id: queryData.emailId,
                    company_phone: queryData.companyPhone || null,
                    company_email: queryData.companyEmail || null,
                    position: queryData.position || null,
                    address: queryData.address || null,
                    created_by: queryData.createdBy || null
                })
                .select()
                .single();

            if (tempError) {
                console.error('[Queries API] Temp client error:', tempError);
                return res.status(500).json({ error: tempError.message });
            }
            tempClientId = tempClient.id;
        }

        // 2. Insert Query with canonical fields
        const payload = {
            client_id: queryData.clientType === 'existing' ? (queryData.clientId || null) : null,
            temporary_client_id: tempClientId,
            profile_id: queryData.profileId || null,
            contact_id: queryData.contactId || null,
            company_name: queryData.companyName || '',
            contact_person: queryData.contactPerson || '',
            contact_number: mainPhone || queryData.contactNumber || '',
            contact_country_code: normalizedCountryCode,
            email_id: queryData.emailId || '',
            company_phone: queryData.companyPhone || null,
            company_email: queryData.companyEmail || null,
            position: queryData.position || null,
            remarks: queryData.remarks || null,
            address: queryData.address || null,
            query_details: queryData.queryDetails || '',
            status: queryData.status || 'Open',
            work_items: Array.isArray(queryData.workItems) ? queryData.workItems : [],
            enquiry_contacts: normalizedContacts,
            created_by: queryData.createdBy || null
        };

        const { data, error } = await supabase
            .from('queries')
            .insert(payload)
            .select('*')
            .single();

        if (error) {
            console.error('[Queries API] Create error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.status(201).json({ success: true, data: formatQuery(data) });
    } catch (error) {
        console.error('[Queries API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/queries/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const queryData = req.body;

        // ── Normalize main contact phone ──────────────────────────────────────
        const { countryCode: normalizedCountryCode, phone: mainPhone } = parsePhoneNumber(
            queryData.contactNumber,
            queryData.contactCountryCode || '+91'
        );

        // ── Normalize enquiry contacts ────────────────────────────────────────
        const normalizedContacts = normalizeEnquiryContacts(queryData.enquiryContacts);

        const updatePayload = {
            profile_id: queryData.profileId || null,
            contact_id: queryData.contactId || null,
            company_name: queryData.companyName || '',
            contact_person: queryData.contactPerson || '',
            contact_number: mainPhone || queryData.contactNumber || '',
            contact_country_code: normalizedCountryCode,
            email_id: queryData.emailId || '',
            company_phone: queryData.companyPhone || null,
            company_email: queryData.companyEmail || null,
            position: queryData.position || null,
            remarks: queryData.remarks || null,
            address: queryData.address || null,
            query_details: queryData.queryDetails || '',
            status: queryData.status,
            work_items: Array.isArray(queryData.workItems) ? queryData.workItems : [],
            enquiry_contacts: normalizedContacts
        };

        const { data, error } = await supabase
            .from('queries')
            .update(updatePayload)
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            console.error('[Queries API] Update error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, data: formatQuery(data) });
    } catch (error) {
        console.error('[Queries API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/queries/:id/access-log
router.post('/:id/access-log', async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeId, employeeName, accessType } = req.body;

        if (!employeeId || !accessType) {
            return res.status(400).json({ error: 'employeeId and accessType are required' });
        }

        const { error } = await supabase
            .from('query_access_logs')
            .insert({
                query_id: id,
                employee_id: employeeId,
                employee_name: employeeName || 'Unknown',
                access_type: accessType
            });

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/queries/:id
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const queryData = req.body;

        const { data, error } = await supabase
            .from('queries')
            .update(queryData)
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            console.error('[Queries API] Patch error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, data: formatQuery(data) });
    } catch (error) {
        console.error('[Queries API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/queries/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('queries')
            .delete()
            .eq('id', id);

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
