const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { parsePhoneNumber, normalizePhoneNumber } = require('../lib/phone');

// GET /api/temporary-clients
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('temporary_clients')
            .select('*')
            .eq('is_converted', false)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Normalize phone on read
        const normalized = (data || []).map(tc => {
            const { countryCode, phone: localNumber } = parsePhoneNumber(
                tc.contact_number,
                tc.contact_country_code || '+91'
            );
            return {
                ...tc,
                contact_number: localNumber,
                contact_country_code: countryCode,
            };
        });

        res.json({ success: true, data: normalized });
    } catch (error) {
        console.error('[Temp Clients API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/temporary-clients/convert/:id
router.post('/convert/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Get temp client info
        const { data: tempClient, error: getError } = await supabase
            .from('temporary_clients')
            .select('*')
            .eq('id', id)
            .single();

        if (getError) throw getError;

        // Normalize phone before copying to clients
        const { fullPhone } = parsePhoneNumber(
            tempClient.contact_number,
            tempClient.contact_country_code || '+91'
        );

        // 2. Insert into main clients table
        const { data: client, error: insertError } = await supabase
            .from('clients')
            .insert({
                client_name: tempClient.company_name,
                email: tempClient.email_id,
                phone: normalizePhoneNumber(tempClient.contact_number),
                country_code: tempClient.contact_country_code || '+91',
                // Add other default fields if needed
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // 3. Update temp client status
        const { error: updateError } = await supabase
            .from('temporary_clients')
            .update({
                is_converted: true,
                converted_client_id: client.id,
                status: 'Approved'
            })
            .eq('id', id);

        if (updateError) throw updateError;

        res.json({ success: true, data: client });
    } catch (error) {
        console.error('[Temp Clients API] Conversion error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
