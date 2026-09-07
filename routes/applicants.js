const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// List Applicants
router.get('/', async (req, res) => {
    try {
        console.log('[Applicants List] Fetching applicants...');
        const { data, error } = await supabase
            .from('applicants')
            .select('*')
            .order('applied_date', { ascending: false });

        if (error) {
            console.error('[Applicants List Supabase Error]:', error);
            throw error;
        }

        res.json(Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('[Applicants List Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Create Applicant
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        console.log(`[Applicants Create] Creating applicant: ${payload.email}`);

        const { data, error } = await supabase
            .from('applicants')
            .insert([payload])
            .select()
            .single();

        if (error) {
            console.error('[Applicants Create Supabase Error]:', error);
            throw error;
        }

        res.json(data);
    } catch (error) {
        console.error('[Applicants Create Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update Applicant
router.put('/:id', async (req, res) => {
    try {
        const payload = req.body;
        const applicantId = req.params.id;
        console.log(`[Applicants Update] Updating applicant ID: ${applicantId}`);

        const { data, error } = await supabase
            .from('applicants')
            .update(payload)
            .eq('id', applicantId)
            .select()
            .single();

        if (error) {
            console.error('[Applicants Update Supabase Error]:', error);
            throw error;
        }

        res.json(data);
    } catch (error) {
        console.error('[Applicants Update Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete Applicant
router.delete('/:id', async (req, res) => {
    try {
        const applicantId = req.params.id;
        console.log(`[Applicants Delete] Deleting applicant ID: ${applicantId}`);

        const { error } = await supabase
            .from('applicants')
            .delete()
            .eq('id', applicantId);

        if (error) {
            console.error('[Applicants Delete Supabase Error]:', error);
            throw error;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Applicants Delete Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
