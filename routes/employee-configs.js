const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// Get Employee ID Configuration
router.get('/id-format', async (req, res) => {
    try {
        const companyId = req.query.companyId || '00000000-0000-0000-0000-000000000000';
        const { data, error } = await supabase
            .from('employee_id_configs')
            .select('*')
            .eq('company_id', companyId)
            .maybeSingle();

        if (error) {
            // Handle missing table gracefully - return null if table doesn't exist yet
            if (error.code === 'PGRST205' || error.code === '42P01') {
                console.warn('[Employee Config API] employee_id_configs table missing. Handled gracefully.');
                return res.json(null);
            }
            throw error;
        }
        res.json(data);
    } catch (error) {
        console.error('[Employee Config API] Fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create or Update Employee ID Configuration
router.post('/id-format', async (req, res) => {
    try {
        const { prefix, digit_count, suffix, company_id } = req.body;
        const companyId = company_id || '00000000-0000-0000-0000-000000000000';

        const { data, error } = await supabase
            .from('employee_id_configs')
            .upsert({
                company_id: companyId,
                prefix: prefix,
                digit_count: parseInt(digit_count),
                suffix: suffix || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'company_id' })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Employee Config API] Save error:', error);
        if (error.code === 'PGRST205' || error.code === '42P01') {
            return res.status(400).json({ 
                error: 'The configuration table does not exist. Please run the SQL migration script: create_employee_id_configs_table.sql' 
            });
        }
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
