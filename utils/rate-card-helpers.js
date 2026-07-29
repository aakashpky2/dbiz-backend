const { supabase } = require('../lib/supabase');

/**
 * Refreshes the status of a rate card based on dates and superseded_by.
 * 
 * Logic:
 * 1. If superseded_by exists -> superseded (inactive)
 * 2. If applicable_until exists and current date > applicable_until -> expired (inactive)
 * 3. If applicable_from > current date -> scheduled (inactive)
 * 4. Else -> active (active)
 */
function extractDateString(dateInput) {
    if (!dateInput) return null;
    if (typeof dateInput === 'string') {
        return dateInput.split('T')[0];
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTodayString() {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', { 
            timeZone: process.env.TZ || 'Asia/Kolkata', 
            year: 'numeric', month: '2-digit', day: '2-digit' 
        });
        // en-CA format is YYYY-MM-DD
        return formatter.format(new Date());
    } catch(e) {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

function calculateStatus(rateCard) {
    const todayStr = getTodayString();
    const fromStr = extractDateString(rateCard.applicable_from);
    const untilStr = extractDateString(rateCard.applicable_until);

    if (rateCard.superseded_by) {
        return { status: 'superseded', is_active: false };
    }

    if (untilStr && todayStr > untilStr) {
        return { status: 'expired', is_active: false };
    }

    if (fromStr && fromStr > todayStr) {
        return { status: 'scheduled', is_active: false };
    }

    return { status: 'active', is_active: true };
}

/**
 * Refreshes statuses of multiple rate cards in the DB.
 */
async function refreshRateCardStatuses() {
    const { data: rateCards, error } = await supabase
        .from('rate_cards')
        .select('id, applicable_from, applicable_until, superseded_by, status, is_active')
        .eq('approval_status', 'approved')
        .not('status', 'eq', 'superseded'); // Optimization: don't refresh already superseded ones

    if (error) {
        console.error('[RateCard Helpers] Error fetching rate cards for refresh:', error);
        return;
    }

    for (const card of rateCards) {
        const { status, is_active } = calculateStatus(card);
        if (status !== card.status || is_active !== card.is_active) {
            await supabase
                .from('rate_cards')
                .update({ status, is_active, updated_at: new Date().toISOString() })
                .eq('id', card.id);
        }
    }
}

/**
 * Superseding logic for a new rate card.
 */
async function supersedeOlderRates(newRateCardId) {
    // 1. Get the new rate card details
    const { data: newCard, error: cardError } = await supabase
        .from('rate_cards')
        .select(`
            *,
            items:rate_card_items!rate_card_id(*)
        `)
        .eq('id', newRateCardId)
        .single();

    if (cardError || !newCard) return;

    const { client_type, associate_id, client_id, business_profile_id, applicable_from, items } = newCard;

    for (const item of items) {
        const query = supabase
            .from('rate_cards')
            .select(`
                id,
                applicable_from,
                items:rate_card_items!rate_card_id!inner(*)
            `)
            .eq('client_type', client_type)
            .eq('associate_id', associate_id || null)
            .eq('client_id', client_id || null) // Exact match for superseding
            .eq('business_profile_id', business_profile_id || null) // Partition superseding by business profile
            .lt('applicable_from', applicable_from)
            .is('superseded_by', null)
            .neq('id', newRateCardId);

        if (item.work_item_id) {
            query.eq('items.work_item_id', item.work_item_id);
        } else {
            query.eq('items.work_item_name', item.work_item_name);
        }

        const { data: olderCards } = await query;

        if (olderCards) {
            for (const oldCard of olderCards) {
                await supabase
                    .from('rate_cards')
                    .update({ 
                        superseded_by: newRateCardId,
                        status: 'superseded',
                        is_active: false,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', oldCard.id);
            }
        }
    }
}

/**
 * Resolves the active rate for a given combination with priority logic.
 * Priority: 
 * 1. Specific client_id
 * 2. Specific associate_id (if associate client)
 * 3. Null associate_id (if associate client, i.e., "All Associates")
 * 4. Default direct rate
 */
const safeArray = (v) => Array.isArray(v) ? v : [];
const sanitizeParam = (p) => (p === 'undefined' || p === 'null' || p === '') ? null : p;

async function resolveMatchingRates(params) {
    const client_type = sanitizeParam(params.client_type);
    const associate_id = sanitizeParam(params.associate_id);
    const client_id = sanitizeParam(params.client_id);
    const business_profile_id = sanitizeParam(params.business_profile_id);
    const work_item_id = sanitizeParam(params.work_item_id);
    const target_date = sanitizeParam(params.target_date);

    const date = target_date || new Date().toISOString().split('T')[0];
    
    console.log('[RATE_SUGGESTIONS] Incoming request:', { work_item_id, client_id, associate_id, business_profile_id, client_type, date });

    if (!work_item_id) {
        console.log('[RATE_SUGGESTIONS] Rejected: missing work_item_id');
        return [];
    }

    // STEP 1: Fetch candidate rate cards (broad fetch)
    const { data: rcData, error: rcError } = await supabase
        .from('rate_cards')
        .select('*')
        .eq('approval_status', 'approved')
        .in('status', ['active', 'scheduled'])
        .lte('applicable_from', date)
        .or(`applicable_until.gte.${date},applicable_until.is.null`);

    if (rcError) {
        console.error('[RATE_SUGGESTIONS] Error fetching candidate rate cards:', rcError);
        return [];
    }

    const candidateCards = safeArray(rcData);
    console.log(`[RATE_SUGGESTIONS] Candidate rate cards found: ${candidateCards.length}`);
    if (candidateCards.length === 0) return [];

    const rcIds = candidateCards.map(rc => rc.id);
    const rcMap = candidateCards.reduce((acc, rc) => { acc[rc.id] = rc; return acc; }, {});

    // STEP 2: Fetch candidate items matching work_item_id (highest priority rule)
    const { data: itemsData, error: itemsError } = await supabase
        .from('rate_card_items')
        .select('*')
        .eq('work_item_id', work_item_id)
        .in('rate_card_id', rcIds);

    if (itemsError) {
        console.error('[RATE_SUGGESTIONS] Error fetching candidate items:', itemsError);
        return [];
    }

    const candidateItems = safeArray(itemsData);
    console.log(`[RATE_SUGGESTIONS] Candidate items found for work type: ${candidateItems.length}`);
    if (candidateItems.length === 0) {
        console.log(`[RATE_SUGGESTIONS] Rejected: 0 rate_card_items for work_item_id`);
        return [];
    }

    const isAll = (arr) => !Array.isArray(arr) || arr.length === 0;

    // STEP 3: Perform applicability filtering in JS
    const matches = [];

    for (const item of candidateItems) {
        const rc = rcMap[item.rate_card_id];
        
        const clientTypes = safeArray(rc.client_types);
        const clientIds = safeArray(rc.client_ids);
        const associateIds = safeArray(rc.associate_ids);
        const businessProfileIds = safeArray(rc.business_profile_ids);
        
        // Exact rule implementations as requested
        const workTypeMatches = true; // inherently true due to DB query
        
        const clientTypeMatches =
            isAll(clientTypes) ||
            clientTypes.includes(client_type) ||
            rc.client_type === client_type;
            
        const businessProfileMatches =
            !business_profile_id ||
            isAll(businessProfileIds) ||
            businessProfileIds.includes(business_profile_id) ||
            rc.business_profile_id === business_profile_id ||
            !rc.business_profile_id;
            
        const clientMatches =
            !client_id ||
            isAll(clientIds) ||
            clientIds.includes(client_id) ||
            rc.client_id === client_id ||
            !rc.client_id;

        const associateMatches =
            !associate_id ||
            isAll(associateIds) ||
            associateIds.includes(associate_id) ||
            rc.associate_id === associate_id ||
            !rc.associate_id;
            
        // Date match is inherently true due to DB query lte/gte but can re-verify if needed, handled.
        const dateMatches = true; 

        // Evaluate final match logic based on type
        let finalMatch = false;
        let rejectedReason = null;
        
        if (client_type === 'direct') {
            if (!clientTypeMatches) rejectedReason = 'client type mismatch';
            else if (!clientMatches) rejectedReason = 'client mismatch';
            else if (!businessProfileMatches) rejectedReason = 'business profile mismatch';
            else finalMatch = true;
        } else {
            if (!clientTypeMatches) rejectedReason = 'client type mismatch';
            else if (!associateMatches) rejectedReason = 'associate mismatch';
            else if (!businessProfileMatches) rejectedReason = 'business profile mismatch';
            else finalMatch = true;
        }
        
        // Custom explicit test/log for June Rate
        if (rc.name === 'June Rate') {
            console.log('June Rate match result:', {
                workTypeMatches,
                clientTypeMatches,
                clientMatches,
                businessProfileMatches,
                dateMatches,
                finalMatch
            });
        }

        if (!finalMatch) {
            console.log(`[RATE_SUGGESTIONS] Rejected: rate_card ${rc.name} (${rc.id}) - ${rejectedReason}`);
            continue;
        }

        // Determine Confidence and Priority (Lower number = higher priority)
        let basePriority = 50;
        let confidenceLabel = 'Generic Default Rate';
        
        const isClientSpecific = clientIds.includes(client_id) || rc.client_id === client_id;
        const isAssociateSpecific = associateIds.includes(associate_id) || rc.associate_id === associate_id;
        const isBPSpecific = businessProfileIds.includes(business_profile_id) || rc.business_profile_id === business_profile_id;

        if (client_type === 'direct' && isClientSpecific) {
            basePriority = 20;
            confidenceLabel = 'Specific Client Match';
        } else if (client_type === 'associate' && isAssociateSpecific) {
            basePriority = 30;
            confidenceLabel = 'Specific Associate Match';
        } else if ((client_type === 'direct' && clientIds.length === 0 && !rc.client_id) || 
                   (client_type === 'associate' && associateIds.length === 0 && !rc.associate_id)) {
            basePriority = 40;
            confidenceLabel = client_type === 'direct' ? 'All Clients' : 'All Associates';
        } else if (clientTypes.length === 0 && !rc.client_type) {
            basePriority = 50;
            confidenceLabel = 'Generic All Client Types';
        }

        let tertiaryPriority = 2; // All BP
        if (isBPSpecific) tertiaryPriority = 1;

        const finalPriority = basePriority + tertiaryPriority;

        matches.push({
            item,
            rate_card: rc,
            confidenceLabel,
            priority: finalPriority,
            applicable_from: new Date(rc.applicable_from).getTime(),
            created_at: new Date(rc.created_at || rc.applicable_from).getTime()
        });
    }

    console.log(`[RATE_SUGGESTIONS] Final matches found: ${matches.length}`);

    // Sort hierarchy
    matches.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (b.applicable_from !== a.applicable_from) return b.applicable_from - a.applicable_from;
        return b.created_at - a.created_at;
    });

    return matches;
}

async function getActiveRate(params) {
    try {
        await refreshRateCardStatuses();
        const matches = await resolveMatchingRates(params);
        if (!matches || matches.length === 0) return null;

        const bestMatch = matches[0];
        
        const { data: govFees } = await supabase
            .from('rate_card_government_fees')
            .select('*')
            .eq('rate_card_item_id', bestMatch.item.id);

        return {
            ...bestMatch.item,
            rate_card: bestMatch.rate_card,
            government_fees: safeArray(govFees)
        };
    } catch (e) {
        console.error('[RATE_SUGGESTIONS] Error in getActiveRate:', e);
        return null;
    }
}

async function getSuggestedRates(params) {
    try {
        await refreshRateCardStatuses();
        const matches = await resolveMatchingRates(params);
        if (!matches || matches.length === 0) return [];

        // Fetch government fees only for final matched items
        const itemIds = matches.map(m => m.item.id);
        const { data: govFees } = await supabase
            .from('rate_card_government_fees')
            .select('*')
            .in('rate_card_item_id', itemIds);

        const govFeesMap = {};
        for (const fee of safeArray(govFees)) {
            if (!govFeesMap[fee.rate_card_item_id]) govFeesMap[fee.rate_card_item_id] = [];
            govFeesMap[fee.rate_card_item_id].push(fee);
        }

        // Map to expected UI shape
        const uniqueSuggestions = [];
        const seenRateCards = new Set();
        
        for (const match of matches) {
            const { item, rate_card, confidenceLabel } = match;
            if (seenRateCards.has(rate_card.id)) continue;
            seenRateCards.add(rate_card.id);

            uniqueSuggestions.push({
                rateCardId: rate_card.id,
                rateCardName: rate_card.name,
                rateCardItemId: item.id,
                workItemId: item.work_item_id,
                workItemName: item.work_item_name,
                professionalFee: item.professional_fee,
                governmentFeeTotal: item.government_fee_total,
                governmentFees: govFeesMap[item.id] || [],
                itemTotal: item.item_total,
                applicableFrom: rate_card.applicable_from,
                applicableUntil: rate_card.applicable_until,
                clientMatchType: params.client_type,
                businessProfileMatch: rate_card.business_profile_id === params.business_profile_id || safeArray(rate_card.business_profile_ids).includes(params.business_profile_id),
                associateMatch: rate_card.associate_id === params.associate_id || safeArray(rate_card.associate_ids).includes(params.associate_id),
                constitutionMatch: false,
                confidenceLabel
            });
        }

        return uniqueSuggestions;
    } catch (err) {
        console.error('[RATE_SUGGESTIONS] Critical error in getSuggestedRates:', err);
        return [];
    }
}

module.exports = {
    calculateStatus,
    refreshRateCardStatuses,
    supersedeOlderRates,
    getActiveRate,
    getSuggestedRates
};

