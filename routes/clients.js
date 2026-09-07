const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');
const { normalizeContactsArray, normalizePhoneNumber, parsePhoneNumber } = require('../lib/phone');

const { normalizeClientPayload } = require('../utils/normalizeClient');

router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});

// GET /api/clients
router.get('/', async (req, res) => {
    try {
        let { fields = 'id,client_name,constitution_id,reference,associate_id,change_status,completion_status,fields,contacts', page = 1, limit = 5, search = '' } = req.query;
        
        page = Math.max(1, parseInt(page) || 1);
        limit = Math.max(1, parseInt(limit) || 5);
        fields = typeof fields === 'string' ? fields : 'id,client_name,constitution_id,reference,associate_id,change_status,completion_status,fields,contacts';
        
        const offset = (page - 1) * limit;

        let query = supabase
            .from('clients')
            .select(fields, { count: 'exact' });

        if (req.query.includeMerged !== 'true') {
            query = query.eq('is_deleted', false);
        }

        if (search) {
            query = query.ilike('client_name', `%${search}%`);
        }

        const { constitution_id, change_status, completion_status } = req.query;
        if (constitution_id && constitution_id !== 'all') {
            query = query.eq('constitution_id', constitution_id);
        }
        if (change_status) {
            query = query.eq('change_status', change_status);
        }
        if (completion_status) {
            query = query.eq('completion_status', completion_status);
        }

        const { data, count, error } = await query
            .order('client_name', { ascending: true })
            .range(offset, offset + limit - 1);


        if (error) {
            return res.status(500).json({
                success: false,
                data: [],
                pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
                error: 'Failed to fetch clients'
            });
        }

        res.json({
            success: true,
            data: data || [],
            pagination: {
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit) || 1
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            data: [],
            pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
            error: 'Internal Server Error'
        });
    }
});

// GET /api/clients/stats
router.get('/stats', async (req, res) => {
    try {
        const [total, pending, incomplete, validated] = await Promise.all([
            supabase.from('clients').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
            supabase.from('clients').select('*', { count: 'exact', head: true }).eq('is_deleted', false).eq('change_status', 'Pending'),
            supabase.from('clients').select('*', { count: 'exact', head: true }).eq('is_deleted', false).eq('completion_status', 'Incomplete'),
            supabase.from('clients').select('*', { count: 'exact', head: true }).eq('is_deleted', false).eq('change_status', 'Validated').eq('completion_status', 'Complete')
        ]);
        res.json({
            success: true,
            total: total.count || 0,
            pending: pending.count || 0,
            incomplete: incomplete.count || 0,
            validated: validated.count || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) {
            console.error('[Clients API] Supabase error:', error);
            return res.status(500).json({
                success: false,
                data: null,
                error: error.message
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                data: null,
                error: 'Client not found'
            });
        }

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('[Clients API] Internal error:', error);
        res.status(500).json({
            success: false,
            data: null,
            error: error.message || "Internal Server Error"
        });
    }
});

// POST /api/clients/merge
router.post('/merge', requirePermission('MANAGE_CLIENTS'), async (req, res) => {
    try {
        const { keepClientId, removeClientId, mergedClient } = req.body;

        if (!keepClientId || !removeClientId || !mergedClient) {
            return res.status(400).json({ success: false, error: 'keepClientId, removeClientId, and mergedClient are required.' });
        }

        if (keepClientId === removeClientId) {
            return res.status(400).json({ success: false, error: 'keepClientId and removeClientId cannot be the same.' });
        }

        // Validate clients exist
        const { data: clients, error: fetchError } = await supabase
            .from('clients')
            .select('id, merge_history')
            .in('id', [keepClientId, removeClientId]);

        if (fetchError || !clients || clients.length < 2) {
            return res.status(404).json({ success: false, error: 'One or both clients not found.' });
        }

        const keepClientRecord = clients.find(c => c.id === keepClientId);
        const removeClientRecord = clients.find(c => c.id === removeClientId);

        const payload = normalizeClientPayload(mergedClient);

        if (!payload.client_name) {
            return res.status(400).json({ success: false, error: 'Client name is required.' });
        }

        // Prepare merge history
        const history = Array.isArray(keepClientRecord.merge_history) ? keepClientRecord.merge_history : [];
        history.push({
            merged_from: removeClientId,
            merged_at: new Date().toISOString(),
            previous_data: removeClientRecord // Optional: keep a snapshot of what was merged
        });

        // 1. Update the kept client
        const { data: updatedClient, error: updateError } = await supabase
            .from('clients')
            .update({
                ...payload,
                merge_history: history,
                updated_at: new Date().toISOString()
            })
            .eq('id', keepClientId)
            .select()
            .single();

        if (updateError) {
            console.error('[Clients API] Merge update error:', updateError);
            return res.status(500).json({ success: false, error: updateError.message });
        }

        // 2. Mark removeClientId as merged/deleted
        const { error: deleteError } = await supabase
            .from('clients')
            .update({
                is_deleted: true,
                is_merged: true,
                merged_into_client_id: keepClientId,
                merged_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', removeClientId);

        if (deleteError) {
            console.error('[Clients API] Merge delete error:', deleteError);
        }

        // 3. Update all related tables
        const relatedTables = [
            'proposals',
            'queries',
            'works',
            'tasks',
            'client_workflows',
            'dsc_links',
            'dsc_movements',
            'token_sales',
            'teams',
            'rate_cards'
        ];

        for (const table of relatedTables) {
            try {
                // Check if table exists before updating (optional but safer)
                await supabase
                    .from(table)
                    .update({ client_id: keepClientId })
                    .eq('client_id', removeClientId);
            } catch (err) {
                console.error(`[Clients API] Failed to update related table ${table}:`, err);
            }
        }

        res.json({
            success: true,
            data: updatedClient,
            message: "Clients merged successfully"
        });

    } catch (error) {
        console.error('[Clients API] Merge internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// POST /api/clients
router.post('/', requirePermission('MANAGE_CLIENTS'), async (req, res) => {
    try {
        const payload = normalizeClientPayload(req.body);
        
        if (!payload.client_name) {
            return res.status(400).json({ success: false, error: 'Client name is required.' });
        }

        // Duplicate Check
        const { data: existing } = await supabase
            .from('clients')
            .select('id, client_name')
            .ilike('client_name', payload.client_name)
            .single();

        if (existing) {
            return res.status(409).json({ success: false, error: 'DUPLICATE_NAME', details: `A client with the name "${payload.client_name}" already exists.` });
        }

        const { data, error } = await supabase
            .from('clients')
            .insert([payload])
            .select()
            .single();

        if (error) {
            console.error('[Clients API] Create error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error('[Clients API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/clients/:id
router.patch('/:id', requirePermission('MANAGE_CLIENTS'), async (req, res) => {
    try {
        const { id } = req.params;
        // Normalize phone fields before DB write
        const updates = normalizeClientPayload(req.body);

        const { data, error } = await supabase
            .from('clients')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Clients API] Update error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
 
        res.json({ success: true, data });
    } catch (error) {
        console.error('[Clients API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/clients/:id
router.put('/:id', requirePermission('MANAGE_CLIENTS'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = normalizeClientPayload(req.body);

        const { data, error } = await supabase
            .from('clients')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Clients API] Update error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
 
        res.json({ success: true, data });
    } catch (error) {
        console.error('[Clients API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/clients/:id
router.delete('/:id', requirePermission('MANAGE_CLIENTS'), async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('[Clients API] Delete error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, message: 'Client deleted successfully.' });
    } catch (error) {
        console.error('[Clients API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
