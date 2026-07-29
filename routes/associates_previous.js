const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/associates
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('associates')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            console.error('[Associates API] Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('[Associates API] Internal error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/associates
router.post('/', async (req, res) => {
    try {
        const assocData = req.body;

        const { data, error } = await supabase
            .from('associates')
            .insert({ name: assocData.name })
            .select()
            .single();

        if (error) {
            console.error('[Associates API] Create error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.status(201).json({ id: data.id, ...data });
    } catch (error) {
        console.error('[Associates API] Internal error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
