const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/template-configurations - List all Data Structure Builder routines
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('template_configurations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/template-configurations/:id
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('template_configurations')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ success: false, error: 'Configuration not found' });
        }
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
