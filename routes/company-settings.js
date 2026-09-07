const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { authenticateToken } = require('./auth');
const { requirePermission } = require('../lib/permissions');

// GET /api/company-settings/active
// Optional query: ?business_profile_id=:id
router.get('/active', authenticateToken, async (req, res) => {
    try {
        const { business_profile_id } = req.query;

        let brandingData = null;

        // 1. If business_profile_id provided, fetch profile settings
        if (business_profile_id) {
            const { data, error } = await supabase
                .from('company_settings')
                .select('*')
                .eq('business_profile_id', business_profile_id)
                .eq('status', 'active')
                .maybeSingle();

            if (!error && data) {
                brandingData = data;
            }
        }

        // 2. If not found or no ID provided, fetch global fallback
        if (!brandingData) {
            const { data, error } = await supabase
                .from('company_settings')
                .select('*')
                .is('business_profile_id', null)
                .eq('is_default', true)
                .eq('status', 'active')
                .maybeSingle();

            if (!error && data) {
                brandingData = data;
            }
        }

        // 3. Return safe default if still not found
        if (!brandingData) {
            brandingData = {
                company_name: '',
                address: '',
                email: '',
                phone: '',
                gstin: '',
                website: '',
                logo_url: '',
                seal_url: '',
                signature_url: ''
            };
        }

        res.json({ success: true, data: brandingData });
    } catch (error) {
        console.error('[Company Settings GET]', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/company-settings
// Upserts active branding for a given profile or global fallback
router.put('/', authenticateToken, requirePermission('MANAGE_SETTINGS'), async (req, res) => {
    try {
        const {
            business_profile_id,
            company_name,
            address,
            email,
            phone,
            gstin,
            website,
            logo_url,
            seal_url,
            signature_url,
            status,
            is_default
        } = req.body;

        const safeProfileId = business_profile_id || null;
        const safeStatus = status || 'active';
        const safeIsDefault = safeProfileId ? false : (is_default === true ? true : false);

        console.log('[Company Settings Payload]', req.body);

        let query = supabase.from('company_settings').select('id').eq('status', 'active');
        
        if (safeProfileId) {
            query = query.eq('business_profile_id', safeProfileId);
        } else {
            query = query.is('business_profile_id', null).eq('is_default', true);
        }

        const { data: existing, error: queryError } = await query.maybeSingle();
        
        if (queryError) {
            throw queryError;
        }

        const payload = {
            company_name: company_name || null,
            address: address || null,
            email: email || null,
            phone: phone || null,
            gstin: gstin || null,
            website: website || null,
            logo_url: logo_url || null,
            seal_url: seal_url || null,
            signature_url: signature_url || null,
            status: safeStatus,
            business_profile_id: safeProfileId,
            is_default: safeIsDefault,
            updated_at: new Date().toISOString()
        };

        let result;
        if (existing) {
            // Update
            result = await supabase
                .from('company_settings')
                .update(payload)
                .eq('id', existing.id)
                .select()
                .maybeSingle();
        } else {
            // Insert
            payload.created_at = new Date().toISOString();
            result = await supabase
                .from('company_settings')
                .insert([payload])
                .select()
                .maybeSingle();
        }

        if (result.error) {
            throw result.error;
        }

        res.json({ success: true, data: result.data });
    } catch (error) {
        console.error('[Company Settings Save Error]', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to save company settings',
            details: error.details || error.hint || error.code || null,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;
