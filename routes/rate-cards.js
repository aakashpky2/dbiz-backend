const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { 
    calculateStatus, 
    refreshRateCardStatuses, 
    supersedeOlderRates, 
    getActiveRate,
    getSuggestedRates
} = require('../utils/rate-card-helpers');
const { requirePermission } = require('../lib/permissions');

function normalizeChangeType(type) {
    if (!type) return 'edit';
    const lower = type.toLowerCase().trim();
    if (lower === 'create' || lower === 'new' || lower === 'add') {
        return 'add';
    }
    if (lower === 'update' || lower === 'modify' || lower === 'edit' || lower === 'edit_rate_card') {
        return 'edit';
    }
    if (lower === 'remove' || lower === 'delete') {
        return 'delete';
    }
    return 'edit';
}

// Middleware: Ensure user is resolved. Since the global authenticateToken middleware runs first,
// we just enforce that req.user is populated.
const resolveUser = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized: User not authenticated' });
    }
    next();
};

// Apply to all rate-card routes
router.use(resolveUser);

// GET /api/rate-cards
router.get('/', async (req, res) => {
    try {
        const { search, client_type, associate_id, client_id, status, approval_status } = req.query;

        try {
            await refreshRateCardStatuses();
        } catch (e) {
            console.error('[RateCard API] Status refresh failed:', e);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Get total count first
        let countQuery = supabase
            .from('rate_cards')
            .select('id', { count: 'exact', head: true });
        
        if (search) countQuery = countQuery.ilike('name', `%${search}%`);
        if (client_type) countQuery = countQuery.eq('client_type', client_type);
        if (associate_id) countQuery = countQuery.eq('associate_id', associate_id);
        if (client_id) {
            countQuery = countQuery.or(`client_id.eq.${client_id},client_ids.cs.{${client_id}}`);
        }
        if (status) countQuery = countQuery.eq('status', status);
        if (approval_status) countQuery = countQuery.eq('approval_status', approval_status);
        if (req.query.business_profile_id) {
            if (req.query.business_profile_id === 'all') {
                countQuery = countQuery.is('business_profile_id', null);
            } else {
                countQuery = countQuery.eq('business_profile_id', req.query.business_profile_id);
            }
        }

        const { count, error: countError } = await countQuery;
        if (countError) throw countError;

        let query = supabase
            .from('rate_cards')
            .select(`
                id,
                name,
                client_type,
                status,
                approval_status,
                applicable_from,
                applicable_until,
                grand_total,
                business_profile_id,
                associate_id,
                client_id,
                client_ids,
                created_at,
                associate:associates!associate_id(id, name),
                client:clients!client_id(id, client_name),
                rate_card_items(count)
            `);

        if (search) query = query.ilike('name', `%${search}%`);
        if (client_type) query = query.eq('client_type', client_type);
        if (associate_id) query = query.eq('associate_id', associate_id);
        if (client_id) {
            query = query.or(`client_id.eq.${client_id},client_ids.cs.{${client_id}}`);
        }
        if (status) query = query.eq('status', status);
        if (approval_status) query = query.eq('approval_status', approval_status);
        if (req.query.business_profile_id) {
            if (req.query.business_profile_id === 'all') {
                query = query.is('business_profile_id', null);
            } else {
                query = query.eq('business_profile_id', req.query.business_profile_id);
            }
        }

        let { data, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;
        data = Array.isArray(data) ? data : [];

        // Fetch business profiles manually to avoid missing FK error
        const allProfileIds = new Set();
        data.forEach(rc => {
            if (rc.business_profile_id) allProfileIds.add(rc.business_profile_id);
            if (Array.isArray(rc.business_profile_ids)) {
                rc.business_profile_ids.forEach(id => {
                    if (id) allProfileIds.add(id);
                });
            }
        });
        const profileIds = [...allProfileIds];
        
        if (profileIds.length > 0) {
            const { data: profiles } = await supabase
                .from('business_profiles')
                .select('id, profile_name')
                .in('id', profileIds);
                
            if (profiles) {
                const profileMap = profiles.reduce((acc, p) => {
                    acc[p.id] = p;
                    return acc;
                }, {});
                
                data = data.map(rc => {
                    const rcProfiles = [];
                    if (Array.isArray(rc.business_profile_ids)) {
                        rc.business_profile_ids.forEach(id => {
                            if (profileMap[id]) rcProfiles.push(profileMap[id]);
                        });
                    }
                    if (rcProfiles.length === 0 && rc.business_profile_id && profileMap[rc.business_profile_id]) {
                        rcProfiles.push(profileMap[rc.business_profile_id]);
                    }
                    return {
                        ...rc,
                        business_profiles: rcProfiles,
                        business_profile: rcProfiles[0] || (rc.business_profile_id ? profileMap[rc.business_profile_id] : null)
                    };
                });
            } else {
                data = data.map(rc => ({ ...rc, business_profiles: [], business_profile: null }));
            }
        } else {
            data = data.map(rc => ({ ...rc, business_profiles: [], business_profile: null }));
        }

        // Fetch clients manually to support client_ids array and backward-compatible mapping
        const allClientIds = new Set();
        data.forEach(rc => {
            if (rc.client_id) allClientIds.add(rc.client_id);
            if (Array.isArray(rc.client_ids)) {
                rc.client_ids.forEach(id => {
                    if (id) allClientIds.add(id);
                });
            }
        });
        const uniqueClientIds = [...allClientIds];

        if (uniqueClientIds.length > 0) {
            const { data: clientsData } = await supabase
                .from('clients')
                .select('id, client_name')
                .in('id', uniqueClientIds);
            
            if (clientsData) {
                const clientMap = clientsData.reduce((acc, c) => {
                    acc[c.id] = c;
                    return acc;
                }, {});

                data = data.map(rc => {
                    const rcClients = [];
                    if (Array.isArray(rc.client_ids)) {
                        rc.client_ids.forEach(id => {
                            if (clientMap[id]) rcClients.push(clientMap[id]);
                        });
                    }
                    if (rcClients.length === 0 && rc.client_id && clientMap[rc.client_id]) {
                        rcClients.push(clientMap[rc.client_id]);
                    }
                    return {
                        ...rc,
                        clients: rcClients,
                        client: rcClients[0] || (rc.client_id ? clientMap[rc.client_id] : null)
                    };
                });
            } else {
                data = data.map(rc => ({ ...rc, clients: [], client: rc.client || null }));
            }
        } else {
            data = data.map(rc => ({ ...rc, clients: [], client: null }));
        }

        // Fetch associates manually to support associate_ids array
        const allAssociateIds = new Set();
        data.forEach(rc => {
            if (rc.associate_id) allAssociateIds.add(rc.associate_id);
            if (Array.isArray(rc.associate_ids)) {
                rc.associate_ids.forEach(id => {
                    if (id) allAssociateIds.add(id);
                });
            }
        });
        const uniqueAssociateIds = [...allAssociateIds];

        if (uniqueAssociateIds.length > 0) {
            const { data: associatesData } = await supabase
                .from('associates')
                .select('id, name')
                .in('id', uniqueAssociateIds);
            
            if (associatesData) {
                const associateMap = associatesData.reduce((acc, a) => {
                    acc[a.id] = a;
                    return acc;
                }, {});

                data = data.map(rc => {
                    const rcAssociates = [];
                    if (Array.isArray(rc.associate_ids)) {
                        rc.associate_ids.forEach(id => {
                            if (associateMap[id]) rcAssociates.push(associateMap[id]);
                        });
                    }
                    if (rcAssociates.length === 0 && rc.associate_id && associateMap[rc.associate_id]) {
                        rcAssociates.push(associateMap[rc.associate_id]);
                    }
                    return {
                        ...rc,
                        associates: rcAssociates,
                        associate: rcAssociates[0] || (rc.associate_id ? associateMap[rc.associate_id] : null)
                    };
                });
            } else {
                data = data.map(rc => ({ ...rc, associates: [], associate: rc.associate || null }));
            }
        } else {
            data = data.map(rc => ({ ...rc, associates: [], associate: null }));
        }

        res.json({ 
            success: true, 
            data,
            total: count || 0,
            page,
            limit,
            total_pages: count ? Math.ceil(count / limit) : 0
        });
    } catch (error) {
        console.error('[RateCard API] Get Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/rate-cards/requests
router.get('/requests', requirePermission('rate_card.approve'), async (req, res) => {
    try {
        const { approval_status } = req.query;
        let query = supabase
            .from('rate_card_item_change_requests')
            .select(`
                *,
                rate_card:rate_cards(id, name)
            `)
            .order('created_at', { ascending: false });

        if (approval_status) {
            query = query.eq('approval_status', approval_status);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json({ success: true, data: Array.isArray(data) ? data : [] });
    } catch (error) {
        console.error('[RateCard API] Get Requests Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/rate-cards/active (Resolver)
router.get('/active', async (req, res) => {
    try {
        const { client_type, associate_id, client_id, business_profile_id, work_item_id, target_date } = req.query;
        
        console.log('[RATE_SUGGESTIONS] Router params:', req.query);

        if (!client_type || !work_item_id) {
            return res.status(400).json({ success: false, error: 'client_type and work_item_id are required' });
        }

        // Sanitize client_type if frontend sent 'existing' or 'new' from proposal form
        let safeClientType = client_type;
        if (safeClientType !== 'direct' && safeClientType !== 'associate') {
            safeClientType = associate_id ? 'associate' : 'direct';
        }

        const suggestions = req.query.suggestions === 'true';

        let data;
        try {
            if (suggestions) {
                data = await getSuggestedRates({
                    client_type: safeClientType,
                    associate_id: safeClientType === 'associate' ? associate_id : null,
                    client_id: client_id || null,
                    business_profile_id: business_profile_id || null,
                    work_item_id,
                    target_date
                });
            } else {
                data = await getActiveRate({
                    client_type: safeClientType,
                    associate_id: safeClientType === 'associate' ? associate_id : null,
                    client_id: client_id || null,
                    business_profile_id: business_profile_id || null,
                    work_item_id,
                    target_date
                });
            }
        } catch (innerErr) {
            console.error('[RATE_SUGGESTIONS] Error executing rate helper:', innerErr);
            return res.json({ success: true, data: suggestions ? [] : null });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[RateCard API] Resolver Error:', error);
        res.json({ success: true, data: req.query.suggestions === 'true' ? [] : null });
    }
});

// GET /api/rate-cards/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: rateCard, error } = await supabase
            .from('rate_cards')
            .select(`
                *,
                associate:associates!associate_id(id, name),
                client:clients!client_id(id, client_name),
                items:rate_card_items!rate_card_id(
                    *,
                    government_fees:rate_card_government_fees!rate_card_item_id(*)
                )
            `)
            .eq('id', id)
            .maybeSingle();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ success: false, error: 'Rate card not found' });
            }
            throw error;
        }

        if (!rateCard) {
            return res.status(404).json({ success: false, error: 'Rate card not found' });
        }

        // Fetch business profiles manually to avoid missing FK error
        const singleProfileIds = [];
        if (rateCard.business_profile_id) singleProfileIds.push(rateCard.business_profile_id);
        if (Array.isArray(rateCard.business_profile_ids)) {
            rateCard.business_profile_ids.forEach(pid => {
                if (pid && !singleProfileIds.includes(pid)) singleProfileIds.push(pid);
            });
        }

        if (singleProfileIds.length > 0) {
            const { data: profiles } = await supabase
                .from('business_profiles')
                .select('id, profile_name')
                .in('id', singleProfileIds);
                
            if (profiles) {
                const profileMap = profiles.reduce((acc, p) => {
                    acc[p.id] = p;
                    return acc;
                }, {});
                
                const rcProfiles = [];
                if (Array.isArray(rateCard.business_profile_ids)) {
                    rateCard.business_profile_ids.forEach(pid => {
                        if (profileMap[pid]) rcProfiles.push(profileMap[pid]);
                    });
                }
                if (rcProfiles.length === 0 && rateCard.business_profile_id && profileMap[rateCard.business_profile_id]) {
                    rcProfiles.push(profileMap[rateCard.business_profile_id]);
                }
                
                rateCard.business_profiles = rcProfiles;
                rateCard.business_profile = rcProfiles[0] || (rateCard.business_profile_id ? profileMap[rateCard.business_profile_id] : null);
            } else {
                rateCard.business_profiles = [];
            }
        } else {
            rateCard.business_profiles = [];
        }

        // Fetch multiple clients if client_ids is present
        const singleClientIds = [];
        if (rateCard.client_id) singleClientIds.push(rateCard.client_id);
        if (Array.isArray(rateCard.client_ids)) {
            rateCard.client_ids.forEach(cid => {
                if (cid && !singleClientIds.includes(cid)) singleClientIds.push(cid);
            });
        }

        if (singleClientIds.length > 0) {
            const { data: clientsData } = await supabase
                .from('clients')
                .select('id, client_name')
                .in('id', singleClientIds);
            
            if (clientsData) {
                const clientMap = clientsData.reduce((acc, c) => {
                    acc[c.id] = c;
                    return acc;
                }, {});
                
                const rcClients = [];
                if (Array.isArray(rateCard.client_ids)) {
                    rateCard.client_ids.forEach(cid => {
                        if (clientMap[cid]) rcClients.push(clientMap[cid]);
                    });
                }
                if (rcClients.length === 0 && rateCard.client_id && clientMap[rateCard.client_id]) {
                    rcClients.push(clientMap[rateCard.client_id]);
                }
                
                rateCard.clients = rcClients;
                rateCard.client = rcClients[0] || (rateCard.client_id ? clientMap[rateCard.client_id] : null);
            } else {
                rateCard.clients = [];
            }
        } else {
            rateCard.clients = [];
        }

        // Fetch multiple associates if associate_ids is present
        const singleAssociateIds = [];
        if (rateCard.associate_id) singleAssociateIds.push(rateCard.associate_id);
        if (Array.isArray(rateCard.associate_ids)) {
            rateCard.associate_ids.forEach(aid => {
                if (aid && !singleAssociateIds.includes(aid)) singleAssociateIds.push(aid);
            });
        }

        if (singleAssociateIds.length > 0) {
            const { data: associatesData } = await supabase
                .from('associates')
                .select('id, name')
                .in('id', singleAssociateIds);
            
            if (associatesData) {
                const associateMap = associatesData.reduce((acc, a) => {
                    acc[a.id] = a;
                    return acc;
                }, {});
                
                const rcAssociates = [];
                if (Array.isArray(rateCard.associate_ids)) {
                    rateCard.associate_ids.forEach(aid => {
                        if (associateMap[aid]) rcAssociates.push(associateMap[aid]);
                    });
                }
                if (rcAssociates.length === 0 && rateCard.associate_id && associateMap[rateCard.associate_id]) {
                    rcAssociates.push(associateMap[rateCard.associate_id]);
                }
                
                rateCard.associates = rcAssociates;
                rateCard.associate = rcAssociates[0] || (rateCard.associate_id ? associateMap[rateCard.associate_id] : null);
            } else {
                rateCard.associates = [];
            }
        } else {
            rateCard.associates = [];
        }

        const { data: requests, error: reqError } = await supabase
            .from('rate_card_item_change_requests')
            .select('*')
            .eq('rate_card_id', id)
            .eq('approval_status', 'pending_approval');
            
        if (reqError) throw reqError;

        res.json({ success: true, data: { ...rateCard, change_requests: requests || [] } });
    } catch (error) {
        console.error('[RateCard API] Get By ID Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/rate-cards
router.post('/', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        let { 
            name, 
            client_type, 
            associate_id, 
            client_id,
            client_ids,
            business_profile_id,
            business_profile_ids,
            constitution_ids,
            sub_constitution_ids,
            client_types,
            associate_ids,
            applicable_from, 
            applicable_until, 
            applicability_mode,
            items
        } = req.body;

        if (!name || !applicable_from) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const deriveLegacyClientType = (cTypes) => {
            if (!cTypes || cTypes.length === 0) return 'direct';
            if (cTypes.includes('direct')) return 'direct';
            if (cTypes.includes('associate')) return 'associate';
            return 'direct';
        };

        client_type = deriveLegacyClientType(client_types);

        if (Array.isArray(client_types) && client_types.includes('direct') && client_types.includes('associate')) {
            client_types = [];
        }

        // Process client_ids and client_id logic
        let resolvedClientIds = client_ids;
        if (resolvedClientIds && !Array.isArray(resolvedClientIds)) {
            resolvedClientIds = [resolvedClientIds];
        } else if (!resolvedClientIds && client_id) {
            resolvedClientIds = [client_id];
        } else if (!resolvedClientIds) {
            resolvedClientIds = [];
        }
        resolvedClientIds = resolvedClientIds.filter(id => id && id !== 'all');
        const resolvedClientId = resolvedClientIds.length > 0 ? resolvedClientIds[0] : null;

        const initialStatus = calculateStatus({ applicable_from, applicable_until });

        const { data: rateCard, error: parentError } = await supabase
            .from('rate_cards')
            .insert({
                name,
                client_type,
                associate_id: client_type === 'associate' ? associate_id : null,
                client_id: resolvedClientId,
                client_ids: resolvedClientIds,
                business_profile_id: business_profile_id || null,
                business_profile_ids: business_profile_ids || [],
                constitution_ids: constitution_ids || [],
                sub_constitution_ids: sub_constitution_ids || [],
                client_types: client_types || [],
                associate_ids: associate_ids || [],
                applicable_from,
                applicable_until: applicability_mode === 'specific_expiry' ? applicable_until : null,
                applicability_mode,
                grand_total: 0,
                status: initialStatus.status,
                is_active: false,
                approval_status: 'draft'
            })
            .select()
            .single();

        if (parentError) throw parentError;

        res.status(201).json({ success: true, data: rateCard });
    } catch (error) {
        console.error('[RateCard API] Create Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/rate-cards/:id
router.put('/:id', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.headers['x-user-id'] || req.body.adminId;
        let { 
            name, 
            client_type, 
            associate_id, 
            client_id,
            client_ids,
            business_profile_id,
            business_profile_ids,
            constitution_ids,
            sub_constitution_ids,
            client_types,
            associate_ids,
            applicable_from, 
            applicable_until, 
            applicability_mode
        } = req.body;

        const deriveLegacyClientType = (cTypes) => {
            if (!cTypes || cTypes.length === 0) return 'direct';
            if (cTypes.includes('direct')) return 'direct';
            if (cTypes.includes('associate')) return 'associate';
            return 'direct';
        };

        client_type = deriveLegacyClientType(client_types);

        if (Array.isArray(client_types) && client_types.includes('direct') && client_types.includes('associate')) {
            client_types = [];
        }

        // Process client_ids and client_id logic
        let resolvedClientIds = client_ids;
        if (resolvedClientIds && !Array.isArray(resolvedClientIds)) {
            resolvedClientIds = [resolvedClientIds];
        } else if (!resolvedClientIds && client_id) {
            resolvedClientIds = [client_id];
        } else if (!resolvedClientIds) {
            resolvedClientIds = [];
        }
        resolvedClientIds = resolvedClientIds.filter(id => id && id !== 'all');
        const resolvedClientId = resolvedClientIds.length > 0 ? resolvedClientIds[0] : null;

        const { data: currentCard, error: cardErr } = await supabase.from('rate_cards').select('*').eq('id', id).maybeSingle();
        if (cardErr && cardErr.code !== 'PGRST116') throw cardErr;
        if (!currentCard) {
            return res.status(404).json({ success: false, error: 'Rate card not found' });
        }

        if (currentCard.approval_status === 'draft') {
            // Update directly
            const initialStatus = calculateStatus({ applicable_from, applicable_until });
            const { error: parentError } = await supabase
                .from('rate_cards')
                .update({
                    name,
                    client_type,
                    associate_id: client_type === 'associate' ? associate_id : null,
                    client_id: resolvedClientId,
                    client_ids: resolvedClientIds,
                    business_profile_id: business_profile_id || null,
                    business_profile_ids: business_profile_ids || [],
                    constitution_ids: constitution_ids || [],
                    sub_constitution_ids: sub_constitution_ids || [],
                    client_types: client_types || [],
                    associate_ids: associate_ids || [],
                    applicable_from,
                    applicable_until: applicability_mode === 'specific_expiry' ? applicable_until : null,
                    applicability_mode,
                    status: initialStatus.status,
                    is_active: initialStatus.is_active,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);

            if (parentError) throw parentError;
            res.json({ success: true, message: 'Rate Card updated successfully' });
        } else {
            // Insert change request for parent details
            const { error } = await supabase.from('rate_card_item_change_requests').insert({
                rate_card_id: id,
                change_type: normalizeChangeType('edit_rate_card'),
                old_data: currentCard,
                new_data: {
                    name,
                    client_type,
                    associate_id: client_type === 'associate' ? associate_id : null,
                    client_id: resolvedClientId,
                    client_ids: resolvedClientIds,
                    business_profile_id: business_profile_id || null,
                    business_profile_ids: business_profile_ids || [],
                    constitution_ids: constitution_ids || [],
                    sub_constitution_ids: sub_constitution_ids || [],
                    client_types: client_types || [],
                    associate_ids: associate_ids || [],
                    applicable_from,
                    applicable_until: applicability_mode === 'specific_expiry' ? applicable_until : null,
                    applicability_mode
                },
                approval_status: 'pending_approval',
                submitted_by: uid
            });

            if (error) throw error;
            res.json({ success: true, message: 'Rate Card edit submitted for approval' });
        }
    } catch (error) {
        console.error('[RateCard API] Update Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper to recalculate grand total
const recalculateGrandTotal = async (rateCardId) => {
    const { data: items, error } = await supabase
        .from('rate_card_items')
        .select('item_total')
        .eq('rate_card_id', rateCardId);
    
    if (error) throw error;
    
    const grandTotal = items.reduce((sum, item) => sum + (parseFloat(item.item_total) || 0), 0);
    
    const { error: updateError } = await supabase
        .from('rate_cards')
        .update({ grand_total: grandTotal, updated_at: new Date().toISOString() })
        .eq('id', rateCardId);
        
    if (updateError) throw updateError;
    return grandTotal;
};



// DELETE /api/rate-cards/:id
router.delete('/:id', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('rate_cards')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Rate Card deleted successfully' });
    } catch (error) {
        console.error('[RateCard API] Delete Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// --- ITEM ENDPOINTS (APPROVAL BUFFER) ---

// POST /api/rate-cards/:id/items
router.post('/:id/items', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.headers['x-user-id'] || req.body.adminId;
        const itemData = req.body;

        // Ensure rate card exists
        const { data: rc, error: rcErr } = await supabase.from('rate_cards').select('approval_status').eq('id', id).maybeSingle();
        if (rcErr && rcErr.code !== 'PGRST116') throw rcErr;
        if (!rc) {
            return res.status(404).json({ success: false, error: 'Rate card not found' });
        }

        // Check for duplicate work_item_id
        const { data: existing } = await supabase
            .from('rate_card_items')
            .select('id')
            .eq('rate_card_id', id)
            .eq('work_item_id', itemData.work_item_id);

        if (existing && existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Duplicate service item found in the Rate Card' });
        }

        if (rc.approval_status === 'draft') {
            // Direct insert into rate_card_items
            const govFeeTotal = (itemData.government_fees || []).reduce((sum, fee) => sum + (parseFloat(fee.amount) || 0), 0);
            const profFeeType = itemData.professional_fee_type || 'fixed';
            const profFeeMin = parseFloat(itemData.professional_fee_min) || 0;
            const profFeeMax = parseFloat(itemData.professional_fee_max) || 0;
            const profFee = profFeeType === 'fixed' ? (parseFloat(itemData.professional_fee) || 0) : 0;
            const itemTotal = profFee + govFeeTotal;

            const { data: savedItem, error: itemError } = await supabase
                .from('rate_card_items')
                .insert({
                    rate_card_id: id,
                    work_item_id: itemData.work_item_id,
                    work_item_name: itemData.work_item_name,
                    department_id: itemData.department_id,
                    category_id: itemData.category_id,
                    constitution_id: itemData.constitution_id,
                    constitution_ids: itemData.constitution_ids || [],
                    sub_constitution_ids: itemData.sub_constitution_ids,
                    constitution_scope: itemData.constitution_scope,
                    professional_fee_type: profFeeType,
                    professional_fee_min: profFeeMin,
                    professional_fee_max: profFeeMax,
                    professional_fee: profFee,
                    government_fee_total: govFeeTotal,
                    item_total: itemTotal,
                    applicable_from: itemData.applicable_from || null,
                    applicability_mode: itemData.applicability_mode || 'until_next_rate',
                    applicable_until: itemData.applicable_until || null,
                    government_fee_filter_values: itemData.government_fee_filter_values || {},
                    government_fee_calculation_mode: itemData.government_fee_calculation_mode || 'dynamic'
                })
                .select()
                .single();

            if (itemError) throw itemError;

            if (itemData.government_fees && itemData.government_fees.length > 0) {
                const govFeesToInsert = itemData.government_fees.map(fee => ({
                    rate_card_item_id: savedItem.id,
                    fee_name: fee.fee_name,
                    amount: parseFloat(fee.amount) || 0,
                    government_fee_rule_id: fee.government_fee_rule_id || null,
                    authority_name: fee.authority_name || null,
                    calculation_type: fee.calculation_type || null,
                    condition_snapshot: fee.condition_snapshot || {},
                    matched_values: fee.matched_values || {},
                    source: fee.source || 'manual',
                    matched_at: fee.matched_at || null
                }));
                await supabase.from('rate_card_government_fees').insert(govFeesToInsert);
            }
            await recalculateGrandTotal(id);
            res.status(201).json({ success: true, message: 'Item added successfully', data: savedItem });
        } else {
            // Insert into change requests
            const { error } = await supabase.from('rate_card_item_change_requests').insert({
                rate_card_id: id,
                change_type: normalizeChangeType(itemData.change_type || 'add'),
                new_data: itemData,
                approval_status: 'pending_approval',
                submitted_by: uid
            });
            if (error) throw error;
            res.json({ success: true, message: 'Item addition submitted for approval' });
        }
    } catch (error) {
        console.error('[RateCard API] Add Item Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/rate-cards/:id/items/:itemId
router.put('/:id/items/:itemId', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const uid = req.headers['x-user-id'] || req.body.adminId;
        const itemData = req.body;

        const { data: rc } = await supabase.from('rate_cards').select('approval_status').eq('id', id).maybeSingle();
        const { data: currentItem } = await supabase.from('rate_card_items').select('*').eq('id', itemId).maybeSingle();
        if (!rc) return res.status(404).json({ success: false, error: 'Rate card not found' });
        if (!currentItem) return res.status(404).json({ success: false, error: 'Item not found' });

        // Check for duplicate work_item_id that is NOT this item
        const { data: existing } = await supabase
            .from('rate_card_items')
            .select('id')
            .eq('rate_card_id', id)
            .eq('work_item_id', itemData.work_item_id)
            .neq('id', itemId);

        if (existing && existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Duplicate service item found in the Rate Card' });
        }

        if (rc.approval_status === 'draft') {
            const govFeeTotal = (itemData.government_fees || []).reduce((sum, fee) => sum + (parseFloat(fee.amount) || 0), 0);
            const profFeeType = itemData.professional_fee_type || 'fixed';
            const profFeeMin = parseFloat(itemData.professional_fee_min) || 0;
            const profFeeMax = parseFloat(itemData.professional_fee_max) || 0;
            const profFee = profFeeType === 'fixed' ? (parseFloat(itemData.professional_fee) || 0) : 0;
            const itemTotal = profFee + govFeeTotal;

            const { error: itemError } = await supabase
                .from('rate_card_items')
                .update({
                    work_item_id: itemData.work_item_id,
                    work_item_name: itemData.work_item_name,
                    department_id: itemData.department_id,
                    category_id: itemData.category_id,
                    constitution_id: itemData.constitution_id,
                    constitution_ids: itemData.constitution_ids || [],
                    sub_constitution_ids: itemData.sub_constitution_ids,
                    constitution_scope: itemData.constitution_scope,
                    professional_fee_type: profFeeType,
                    professional_fee_min: profFeeMin,
                    professional_fee_max: profFeeMax,
                    professional_fee: profFee,
                    government_fee_total: govFeeTotal,
                    item_total: itemTotal,
                    applicable_from: itemData.applicable_from || null,
                    applicability_mode: itemData.applicability_mode || 'until_next_rate',
                    applicable_until: itemData.applicable_until || null,
                    government_fee_filter_values: itemData.government_fee_filter_values || {},
                    government_fee_calculation_mode: itemData.government_fee_calculation_mode || 'dynamic'
                })
                .eq('id', itemId);

            if (itemError) throw itemError;

            await supabase.from('rate_card_government_fees').delete().eq('rate_card_item_id', itemId);
            if (itemData.government_fees && itemData.government_fees.length > 0) {
                const govFeesToInsert = itemData.government_fees.map(fee => ({
                    rate_card_item_id: itemId,
                    fee_name: fee.fee_name,
                    amount: parseFloat(fee.amount) || 0,
                    government_fee_rule_id: fee.government_fee_rule_id || null,
                    authority_name: fee.authority_name || null,
                    calculation_type: fee.calculation_type || null,
                    condition_snapshot: fee.condition_snapshot || {},
                    matched_values: fee.matched_values || {},
                    source: fee.source || 'manual',
                    matched_at: fee.matched_at || null
                }));
                await supabase.from('rate_card_government_fees').insert(govFeesToInsert);
            }

            await recalculateGrandTotal(id);
            res.json({ success: true, message: 'Item updated successfully' });
        } else {
            const { error } = await supabase.from('rate_card_item_change_requests').insert({
                rate_card_id: id,
                rate_card_item_id: itemId,
                change_type: normalizeChangeType(itemData.change_type || 'edit'),
                old_data: currentItem,
                new_data: itemData,
                approval_status: 'pending_approval',
                submitted_by: uid
            });
            if (error) throw error;
            res.json({ success: true, message: 'Item edit submitted for approval' });
        }
    } catch (error) {
        console.error('[RateCard API] Update Item Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/rate-cards/:id/items/:itemId
router.delete('/:id/items/:itemId', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const uid = req.headers['x-user-id'] || req.body.adminId;

        const { data: rc } = await supabase.from('rate_cards').select('approval_status').eq('id', id).maybeSingle();
        const { data: currentItem } = await supabase.from('rate_card_items').select('*').eq('id', itemId).maybeSingle();
        if (!rc) return res.status(404).json({ success: false, error: 'Rate card not found' });
        if (!currentItem) return res.status(404).json({ success: false, error: 'Item not found' });

        if (rc.approval_status === 'draft') {
            await supabase.from('rate_card_items').delete().eq('id', itemId);
            await recalculateGrandTotal(id);
            res.json({ success: true, message: 'Item deleted successfully' });
        } else {
            const { error } = await supabase.from('rate_card_item_change_requests').insert({
                rate_card_id: id,
                rate_card_item_id: itemId,
                change_type: normalizeChangeType('delete'),
                old_data: currentItem,
                approval_status: 'pending_approval',
                submitted_by: uid
            });
            if (error) throw error;
            res.json({ success: true, message: 'Item deletion submitted for approval' });
        }
    } catch (error) {
        console.error('[RateCard API] Delete Item Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- APPROVAL ENDPOINTS ---

// Submit Rate Card Draft for Approval
router.post('/:id/submit', requirePermission('MANAGE_RATE_CARDS'), async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.headers['x-user-id'] || req.body.adminId;

        const { error } = await supabase
            .from('rate_cards')
            .update({
                approval_status: 'pending_approval',
                submitted_by: uid,
                submitted_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('approval_status', 'draft');

        if (error) throw error;
        res.json({ success: true, message: 'Rate Card submitted for approval' });
    } catch (error) {
        console.error('[RateCard API] Submit Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve entire Rate Card
router.post('/:id/approve', requirePermission('rate_card.approve'), async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.user?.id || req.body.adminId || req.headers['x-user-id'];

        const { data: rc } = await supabase.from('rate_cards').select('*').eq('id', id).maybeSingle();
        if (!rc) {
            return res.status(404).json({ success: false, error: 'Rate card not found' });
        }
        if (rc.approval_status !== 'pending_approval') {
            return res.status(400).json({ success: false, error: 'Rate Card is not pending approval' });
        }

        const { error } = await supabase
            .from('rate_cards')
            .update({
                approval_status: 'approved',
                approved_by: uid,
                approved_at: new Date().toISOString(),
                is_active: true
            })
            .eq('id', id);

        if (error) throw error;

        // Supersede older ones since this is now active
        await supersedeOlderRates(id);

        res.json({ success: true, message: 'Rate Card approved successfully' });
    } catch (error) {
        console.error('[RateCard API] Approve Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reject entire Rate Card
router.post('/:id/reject', requirePermission('rate_card.approve'), async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.user?.id || req.body.adminId || req.headers['x-user-id'];
        const { rejection_reason } = req.body;

        const { error } = await supabase
            .from('rate_cards')
            .update({
                approval_status: 'rejected',
                rejected_by: uid,
                rejected_at: new Date().toISOString(),
                rejection_reason
            })
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Rate Card rejected' });
    } catch (error) {
        console.error('[RateCard API] Reject Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve an Item Change Request
router.post('/requests/:requestId/approve', requirePermission('rate_card.approve'), async (req, res) => {
    try {
        const { requestId } = req.params;
        const uid = req.user?.id || req.body.adminId || req.headers['x-user-id'];

        const { data: reqData, error: reqErr } = await supabase
            .from('rate_card_item_change_requests')
            .select('*')
            .eq('id', requestId)
            .maybeSingle();

        if (reqErr && reqErr.code !== 'PGRST116') throw reqErr;
        if (!reqData || reqData.approval_status !== 'pending_approval') {
            return res.status(400).json({ success: false, error: 'Invalid or already processed request' });
        }

        // Apply logic
        if (reqData.change_type === 'edit_rate_card' || (reqData.change_type === 'edit' && !reqData.rate_card_item_id)) {
            const { error } = await supabase.from('rate_cards').update(reqData.new_data).eq('id', reqData.rate_card_id);
            if (error) throw error;
        } else if (reqData.change_type === 'add') {
            const itemData = reqData.new_data;
            const govFeeTotal = (itemData.government_fees || []).reduce((sum, fee) => sum + (parseFloat(fee.amount) || 0), 0);
            const profFeeType = itemData.professional_fee_type || 'fixed';
            const profFeeMin = parseFloat(itemData.professional_fee_min) || 0;
            const profFeeMax = parseFloat(itemData.professional_fee_max) || 0;
            const profFee = profFeeType === 'fixed' ? (parseFloat(itemData.professional_fee) || 0) : 0;
            
            const { data: savedItem, error: itemError } = await supabase
                .from('rate_card_items')
                .insert({
                    rate_card_id: reqData.rate_card_id,
                    work_item_id: itemData.work_item_id,
                    work_item_name: itemData.work_item_name,
                    department_id: itemData.department_id,
                    category_id: itemData.category_id,
                    constitution_id: itemData.constitution_id,
                    sub_constitution_ids: itemData.sub_constitution_ids,
                    constitution_scope: itemData.constitution_scope,
                    professional_fee_type: profFeeType,
                    professional_fee_min: profFeeMin,
                    professional_fee_max: profFeeMax,
                    professional_fee: profFee,
                    government_fee_total: govFeeTotal,
                    item_total: profFee + govFeeTotal
                })
                .select()
                .single();

            if (itemError) throw itemError;

            if (itemData.government_fees && itemData.government_fees.length > 0) {
                const govFeesToInsert = itemData.government_fees.map(fee => ({
                    rate_card_item_id: savedItem.id,
                    fee_name: fee.fee_name,
                    amount: parseFloat(fee.amount) || 0
                }));
                await supabase.from('rate_card_government_fees').insert(govFeesToInsert);
            }
        } else if (reqData.change_type === 'edit') {
            const itemData = reqData.new_data;
            const govFeeTotal = (itemData.government_fees || []).reduce((sum, fee) => sum + (parseFloat(fee.amount) || 0), 0);
            const profFeeType = itemData.professional_fee_type || 'fixed';
            const profFeeMin = parseFloat(itemData.professional_fee_min) || 0;
            const profFeeMax = parseFloat(itemData.professional_fee_max) || 0;
            const profFee = profFeeType === 'fixed' ? (parseFloat(itemData.professional_fee) || 0) : 0;

            const { error: itemError } = await supabase
                .from('rate_card_items')
                .update({
                    work_item_id: itemData.work_item_id,
                    work_item_name: itemData.work_item_name,
                    department_id: itemData.department_id,
                    category_id: itemData.category_id,
                    constitution_id: itemData.constitution_id,
                    sub_constitution_ids: itemData.sub_constitution_ids,
                    constitution_scope: itemData.constitution_scope,
                    professional_fee_type: profFeeType,
                    professional_fee_min: profFeeMin,
                    professional_fee_max: profFeeMax,
                    professional_fee: profFee,
                    government_fee_total: govFeeTotal,
                    item_total: profFee + govFeeTotal
                })
                .eq('id', reqData.rate_card_item_id);

            if (itemError) throw itemError;

            await supabase.from('rate_card_government_fees').delete().eq('rate_card_item_id', reqData.rate_card_item_id);
            if (itemData.government_fees && itemData.government_fees.length > 0) {
                const govFeesToInsert = itemData.government_fees.map(fee => ({
                    rate_card_item_id: reqData.rate_card_item_id,
                    fee_name: fee.fee_name,
                    amount: parseFloat(fee.amount) || 0
                }));
                await supabase.from('rate_card_government_fees').insert(govFeesToInsert);
            }
        } else if (reqData.change_type === 'delete') {
            await supabase.from('rate_card_items').delete().eq('id', reqData.rate_card_item_id);
        }

        // Mark request as approved
        await supabase
            .from('rate_card_item_change_requests')
            .update({
                approval_status: 'approved',
                approved_by: uid,
                approved_at: new Date().toISOString()
            })
            .eq('id', requestId);

        await recalculateGrandTotal(reqData.rate_card_id);

        res.json({ success: true, message: 'Change approved successfully' });
    } catch (error) {
        console.error('[RateCard API] Approve Request Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reject an Item Change Request
router.post('/requests/:requestId/reject', requirePermission('rate_card.approve'), async (req, res) => {
    try {
        const { requestId } = req.params;
        const uid = req.user?.id || req.body.adminId || req.headers['x-user-id'];
        const { rejection_reason } = req.body;

        const { error } = await supabase
            .from('rate_card_item_change_requests')
            .update({
                approval_status: 'rejected',
                rejected_by: uid,
                rejected_at: new Date().toISOString(),
                rejection_reason
            })
            .eq('id', requestId);

        if (error) throw error;

        res.json({ success: true, message: 'Change rejected successfully' });
    } catch (error) {
        console.error('[RateCard API] Reject Request Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

