const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// List Job Openings
router.get('/', async (req, res) => {
    try {
        console.log('[Job Openings List] Fetching job openings...');
        const { data, error } = await supabase
            .from('job_openings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[Job Openings List Supabase Error]:', error);
            throw error;
        }

        res.json(Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('[Job Openings List Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Create Job Opening
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        console.log(`[Job Openings Create] Creating job opening: ${payload.title}`);

        const { data, error } = await supabase
            .from('job_openings')
            .insert([payload])
            .select()
            .single();

        if (error) {
            console.error('[Job Openings Create Supabase Error]:', error);
            throw error;
        }

        res.json(data);
    } catch (error) {
        console.error('[Job Openings Create Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update Job Opening
router.put('/:id', async (req, res) => {
    try {
        const payload = req.body;
        const jobOpeningId = req.params.id;
        console.log(`[Job Openings Update] Updating job opening ID: ${jobOpeningId}`);

        const { data, error } = await supabase
            .from('job_openings')
            .update(payload)
            .eq('id', jobOpeningId)
            .select()
            .single();

        if (error) {
            console.error('[Job Openings Update Supabase Error]:', error);
            throw error;
        }

        res.json(data);
    } catch (error) {
        console.error('[Job Openings Update Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete Job Opening
router.delete('/:id', async (req, res) => {
    try {
        const jobOpeningId = req.params.id;
        console.log(`[Job Openings Delete] Deleting job opening ID: ${jobOpeningId}`);

        const { error } = await supabase
            .from('job_openings')
            .delete()
            .eq('id', jobOpeningId);

        if (error) {
            console.error('[Job Openings Delete Supabase Error]:', error);
            throw error;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Job Openings Delete Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
