const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// List Interviews
router.get('/', async (req, res) => {
    try {
        console.log('[Interviews List] Fetching interviews...');
        const { data, error } = await supabase
            .from('interviews')
            .select(`
                *,
                applicants (
                    name,
                    email,
                    position
                )
            `)
            .order('interview_date', { ascending: true });

        if (error) {
            console.error('[Interviews List Supabase Error]:', error);
            throw error;
        }

        res.json(data);
    } catch (error) {
        console.error('[Interviews List Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update Interview Status
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const interviewId = req.params.id;
        console.log(`[Interviews Status Update] Updating interview ID: ${interviewId} to status: ${status}`);

        const { error } = await supabase
            .from('interviews')
            .update({ status })
            .eq('id', interviewId);

        if (error) {
            console.error('[Interviews Status Update Supabase Error]:', error);
            throw error;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Interviews Status Update Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete Interview
router.delete('/:id', async (req, res) => {
    try {
        const interviewId = req.params.id;
        console.log(`[Interviews Delete] Deleting interview ID: ${interviewId}`);

        const { error } = await supabase
            .from('interviews')
            .delete()
            .eq('id', interviewId);

        if (error) {
            console.error('[Interviews Delete Supabase Error]:', error);
            throw error;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Interviews Delete Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
