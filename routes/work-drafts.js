const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/work-drafts (Get user's draft)
router.get('/', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { data, error } = await supabase
            .from('work_drafts')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.error('[WorkDrafts GET] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(data || { form_data: {}, current_step: 0 });
    } catch (error) {
        console.error('[WorkDrafts GET] Catch:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/work-drafts (Save or update draft)
router.post('/', async (req, res) => {
    try {
        const { userId, formData, currentStep } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { data, error } = await supabase
            .from('work_drafts')
            .upsert({
                user_id: userId,
                form_data: formData || {},
                current_step: currentStep || 0
            }, { onConflict: 'user_id' })
            .select()
            .single();

        if (error) {
            console.error('[WorkDrafts POST] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('[WorkDrafts POST] Catch:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/work-drafts (Clear draft)
router.delete('/', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { error } = await supabase
            .from('work_drafts')
            .delete()
            .eq('user_id', userId);

        if (error) {
            console.error('[WorkDrafts DELETE] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ status: 'deleted' });
    } catch (error) {
        console.error('[WorkDrafts DELETE] Catch:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
