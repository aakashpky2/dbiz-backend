const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const {
    parsePhoneNumber,
    normalizeDialCode,
    normalizePhoneNumber,
    normalizeContactsArray,
} = require('../lib/phone');

// GET /api/associates
router.get('/', async (req, res) => {
    try {
        const { profileId, page = 1, limit = 5, search = '', fields } = req.query;
        const offset = (page - 1) * limit;

        let queryBuilder = supabase
            .from('associates')
            .select(`
                *,
                parent:associates!parent_id(id, name),
                profiles:associate_profiles(profile_id, business_profiles(profile_name)),
                rates:associate_rates(*)
            `, { count: 'exact' });

        if (search) {
            queryBuilder = queryBuilder.ilike('name', `%${search}%`);
        }
        if (req.query.status) {
            queryBuilder = queryBuilder.eq('status', req.query.status);
        }

        const { data, count, error } = await queryBuilder
            .order('name', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Associates API] Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Process data to return the latest rate and flattened profiles
        const processedData = data.map(assoc => {
            const rates = (assoc.rates || []).sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
            const activeRate = rates.find(r => new Date(r.effective_date) <= new Date());

            // Normalize phone on read so frontend always gets a consistent value
            const { countryCode, phone: localNumber } = parsePhoneNumber(assoc.phone, assoc.country_code || '+91');

            return {
                ...assoc,
                phone: localNumber,
                countryCode: countryCode || assoc.country_code || '+91',
                profiles: (assoc.profiles || []).map(p => p.profile_id),
                profileNames: (assoc.profiles || []).map(p => p.business_profiles?.profile_name),
                activeRate: activeRate || rates[0]
            };
        });

        let finalData = processedData;
        if (profileId) {
            finalData = processedData.filter(assoc => assoc.profiles.includes(profileId));
        }

        res.json({
            success: true,
            data: finalData,
            pagination: {
                total: count || 0,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil((count || 0) / limit) || 1
            }
        });
    } catch (error) {
        console.error('[Associates API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/associates
router.post('/', async (req, res) => {
    try {
        const { name, email, phone, countryCode, status, profiles, billingRules, commissionRules, billingDetails, commissionPercentage, effectiveDate, parent_id } = req.body;

        // ── Normalize phone ───────────────────────────────────────────────────
        const { fullPhone, countryCode: normalizedCode } = parsePhoneNumber(phone, countryCode || '+91');

        // 1. Insert Associate
        const { data: associate, error: assocError } = await supabase
            .from('associates')
            .insert({ 
                name, 
                email, 
                phone: normalizePhoneNumber(phone), 
                country_code: normalizedCode,
                status: status || 'Active',
                parent_id: parent_id || null,
                billing_rules: billingRules || [],
                commission_rules: commissionRules || []
            })
            .select()
            .single();

        if (assocError) throw assocError;

        // 2. Insert Profiles Associations
        if (profiles && profiles.length > 0) {
            const profileLinks = profiles.map(pid => ({
                associate_id: associate.id,
                profile_id: pid
            }));
            const { error: profileError } = await supabase
                .from('associate_profiles')
                .insert(profileLinks);
            if (profileError) throw profileError;
        }

        // 3. Insert Initial Rate
        const { error: rateError } = await supabase
            .from('associate_rates')
            .insert({
                associate_id: associate.id,
                billing_details: billingDetails,
                commission_percentage: commissionPercentage,
                effective_date: effectiveDate
            });
        if (rateError) throw rateError;

        res.status(201).json({ success: true, ...associate });
    } catch (error) {
        console.error('[Associates API] Create error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/associates/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, countryCode, status, profiles, billingRules, commissionRules, billingDetails, commissionPercentage, effectiveDate, parent_id } = req.body;

        console.log('[Associates PUT] Received update for:', id);

        // ── Normalize phone ───────────────────────────────────────────────────
        const normalizedNumber = normalizePhoneNumber(phone);
        const normalizedCode = normalizeDialCode(countryCode || '+91');

        // 1. Update Associate
        const { error: assocError } = await supabase
            .from('associates')
            .update({ 
                name, 
                email, 
                phone: normalizedNumber, 
                country_code: normalizedCode,
                status, 
                parent_id: parent_id || null,
                billing_rules: billingRules || [],
                commission_rules: commissionRules || [],
                updated_at: new Date().toISOString() 
            })
            .eq('id', id);

        if (assocError) throw assocError;

        // 2. Update Profiles Associations (Sync patterns: delete and re-insert)
        const { error: deleteProfilesError } = await supabase
            .from('associate_profiles')
            .delete()
            .eq('associate_id', id);
        
        if (deleteProfilesError) throw deleteProfilesError;

        if (profiles && profiles.length > 0) {
            const profileLinks = profiles.map(pid => ({
                associate_id: id,
                profile_id: pid
            }));
            const { error: profileError } = await supabase
                .from('associate_profiles')
                .insert(profileLinks);
            if (profileError) throw profileError;
        }

        // 3. Update Rate Logic: If any rate field changed, insert a new record
        const { data: ratesData, error: ratesFetchError } = await supabase
            .from('associate_rates')
            .select('*')
            .eq('associate_id', id)
            .order('created_at', { ascending: false })
            .limit(1);

        if (ratesFetchError) {
            console.error('[Associates API] Error fetching rates during update:', ratesFetchError);
        }

        const latestRate = ratesData && ratesData.length > 0 ? ratesData[0] : null;

        const formatDate = (date) => {
            if (!date) return null;
            return new Date(date).toISOString().split('T')[0];
        };

        const hasRateChanged = !latestRate || 
            latestRate.billing_details !== billingDetails || 
            parseFloat(latestRate.commission_percentage) !== parseFloat(commissionPercentage) ||
            formatDate(latestRate.effective_date) !== formatDate(effectiveDate);

        if (hasRateChanged) {
            const { error: rateError } = await supabase
                .from('associate_rates')
                .insert({
                    associate_id: id,
                    billing_details: billingDetails,
                    commission_percentage: commissionPercentage,
                    effective_date: formatDate(effectiveDate) || effectiveDate
                });
            if (rateError) throw rateError;
        }

        res.json({ success: true, message: 'Associate updated successfully' });
    } catch (error) {
        console.error('[Associates API] Update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/associates/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('associates')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: 'Associate deleted successfully' });
    } catch (error) {
        console.error('[Associates API] Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
