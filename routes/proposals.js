const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');
const { parsePhoneNumber, normalizeDialCode, normalizeContactsArray } = require('../lib/phone');
const ProposalCalculationService = require('../services/ProposalCalculationService');
const ProposalTemplateContextService = require('../services/ProposalTemplateContextService');

// Helper to format snake_case to camelCase
const formatProposal = (p) => ({
    // ... existing fields ...
    id: p.id,
    profileId: p.profile_id,
    queryId: p.query_id,
    clientId: p.client_id,
    tempClientId: p.temp_client_id,
    clientName: p.client_name,
    proposedWork: p.proposed_work || [],
    description: p.description,
    professionalFee: p.professional_fee || 0,
    governmentFee: p.government_fee || 0,
    gstPercentage: p.gst_percentage || 0,
    gstTarget: p.gst_target || 'None',
    gstAmount: p.gst_amount || 0,
    totalAmount: p.total_amount || 0,
    status: p.status,
    currentStage: p.current_stage || 'Draft',
    proposalStages: p.proposal_stages || [],
    contacts: p.contacts || [],
    followUps: p.follow_ups || [],
    conversionProbability: p.conversion_probability || 50,
    assignedTo: p.assigned_to,
    nextFollowUpDate: p.next_follow_up_date,
    lastFollowUpDate: p.last_follow_up_date,
    sentDate: p.sent_date,
    approvalStatus: p.approval_status || 'Pending Approval',
    version: p.version || '1.0',
    processingDays: p.processing_days || 0,
    processingHours: p.processing_hours || 0,
    createdBy: p.created_by,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    updatedBy: p.updated_by || null,
    // Resolved display names (populated by resolveProposalUserNames after fetch)
    createdByName: p.created_by_name || null,
    updatedByName: p.updated_by_name || null,
    sentAt: p.sent_at,
    sentByName: p.sent_by_name,
    sentByEmail: p.sent_by_email,
    sentByPosition: p.sent_by_position,
    sentByPhone: p.sent_by_phone,
    phone: p.phone,
    email: p.email,
    countryCode: p.country_code,
    noInvoice: p.no_invoice || false,
    discountType: p.discount_type || 'amount',
    discountValue: Number(p.discount_value ?? 0),
    discountAmount: Number(p.discount_amount ?? 0),
    totalBeforeDiscount: Number(p.total_before_discount ?? p.total_amount ?? 0),
    convertedToWork: p.converted_to_work || false,
    convertedAt: p.converted_at,
    conversionStatus: p.conversion_status || 'Not Converted'
});

/**
 * Resolve created_by / updated_by user IDs to display names via user_profiles.
 * Mutates each item in-place, adding createdByName and updatedByName.
 */
async function resolveProposalUserNames(items) {
    const ids = new Set();
    const uids = new Set();

    for (const item of items || []) {
        const addId = (v) => {
            if (!v) return;
            const s = String(v);
            // UUID = 36 chars; Firebase UIDs are shorter strings
            if (s.length === 36) ids.add(s);
            else uids.add(s);
        };
        addId(item.createdBy);
        addId(item.updatedBy);
    }

    if (ids.size === 0 && uids.size === 0) return items;

    const profileMap = {};

    if (ids.size > 0) {
        const { data: rows } = await supabase
            .from('user_profiles')
            .select('id, uid, full_name, display_name, email')
            .in('id', Array.from(ids));
        for (const r of rows || []) {
            const name = r.full_name || r.display_name || r.email || null;
            profileMap[String(r.id)] = name;
            if (r.uid) profileMap[String(r.uid)] = name;
        }
    }

    if (uids.size > 0) {
        const { data: rows } = await supabase
            .from('user_profiles')
            .select('id, uid, full_name, display_name, email')
            .in('uid', Array.from(uids));
        for (const r of rows || []) {
            const name = r.full_name || r.display_name || r.email || null;
            profileMap[String(r.uid)] = name;
            profileMap[String(r.id)] = name;
        }
    }

    return items.map(item => ({
        ...item,
        createdByName: item.createdBy ? (profileMap[String(item.createdBy)] || null) : null,
        updatedByName: item.updatedBy ? (profileMap[String(item.updatedBy)] || null) : null,
    }));
}


/**
 * Helper to log history events
 */
const logProposalHistory = async ({
    proposalId,
    eventType,
    previousStage,
    newStage,
    previousVersion,
    newVersion,
    performedBy,
    description,
    metadata = {}
}) => {
    try {
        await supabase.from('proposal_history').insert({
            proposal_id: proposalId,
            event_type: eventType,
            previous_stage: previousStage,
            new_stage: newStage,
            previous_version: previousVersion,
            new_version: newVersion,
            performed_by: performedBy,
            description,
            metadata
        });
    } catch (error) {
        console.error('Error logging proposal history:', error);
    }
};

/**
 * Helper to detect changed fields between snapshots
 */
const getChangedFields = (oldData, newData) => {
    const changes = [];
    const fieldsToTrack = [
        'proposed_work', 'professional_fee', 'government_fee', 
        'gst_amount', 'total_amount', 'description', 'processing_days', 
        'processing_hours', 'client_name', 'profile_id', 'no_invoice',
        'discount_type', 'discount_value', 'discount_amount', 'total_before_discount'
    ];

    fieldsToTrack.forEach(field => {
        const oldVal = JSON.stringify(oldData[field]);
        const newVal = JSON.stringify(newData[field]);
        
        if (oldVal !== newVal) {
            changes.push({
                field,
                old: oldData[field],
                new: newData[field]
            });
        }
    });

    return changes;
};

/**
 * Resolve the best template for a proposal
 */
async function resolveProposalTemplate(proposal) {
    // 1. If snapshot exists, return it
    if (proposal.template_snapshot) {
        return {
            source: 'snapshot',
            template_id: proposal.template_id,
            configuration_id: proposal.template_configuration_id,
            template_content: proposal.template_snapshot.template_content,
            template_name: proposal.template_snapshot.template_name,
            mappings: proposal.template_snapshot.mappings || []
        };
    }

    // 2. Look for explicit configuration_id on proposal
    if (proposal.template_configuration_id) {
        const { data: config } = await supabase.from('template_configurations').select('*').eq('id', proposal.template_configuration_id).maybeSingle();
        if (config) {
            const { data: template } = await supabase.from('templates').select('*').eq('id', config.template_id).maybeSingle();
            if (template) {
                return { source: 'configuration', template_id: config.template_id, configuration_id: config.id, template_content: template.content, template_name: template.name, mappings: config.mappings || [] };
            }
        }
    }

    // 3. Find active configs for proposals
    const { data: configs } = await supabase.from('template_configurations').select('*').order('created_at', { ascending: false });
    if (!configs || configs.length === 0) return null;

    let bestConfig = configs.find(c => 
        (c.tag && c.tag.toLowerCase().includes('proposal')) || 
        (c.category && c.category.toLowerCase().includes('proposal')) ||
        (c.module && c.module.toLowerCase().includes('proposal')) ||
        (c.name && c.name.toLowerCase().includes('proposal'))
    );

    if (!bestConfig) return null;

    const { data: template } = await supabase.from('templates').select('*').eq('id', bestConfig.template_id).maybeSingle();
    if (!template) return null;

    return {
        source: 'configuration',
        template_id: bestConfig.template_id,
        configuration_id: bestConfig.id,
        template_content: template.content,
        template_name: template.name,
        mappings: bestConfig.mappings || []
    };
}

/**
 * Helper to capture template snapshot on approval/send
 */
async function captureTemplateSnapshotIfNeeded(proposalId, currentProposal) {
    if (currentProposal.template_snapshot) return; // Already frozen

    const resolved = await resolveProposalTemplate(currentProposal);
    if (resolved && resolved.source === 'configuration') {
        const snapshot = {
            template_id: resolved.template_id,
            template_name: resolved.template_name,
            template_content: resolved.template_content,
            configuration_id: resolved.configuration_id,
            mappings: resolved.mappings,
            generated_at: new Date().toISOString()
        };

        await supabase.from('proposals').update({
            template_id: resolved.template_id,
            template_configuration_id: resolved.configuration_id,
            template_snapshot: snapshot
        }).eq('id', proposalId);
    }
}

// GET /api/proposals
router.get('/', async (req, res) => {
    try {
        const defaultFields = 'id,profile_id,query_id,client_id,temp_client_id,client_name,professional_fee,government_fee,gst_amount,total_amount,status,current_stage,assigned_to,next_follow_up_date,last_follow_up_date,sent_date,approval_status,version,created_by,created_at,updated_at,updated_by,sent_at';
        const { fields = defaultFields, page = 1, limit = 5, search = '', status = '', profileId = '', tab = '' } = req.query;
        const offset = (page - 1) * limit;

        let queryBuilder = supabase
            .from('proposals')
            .select(fields, { count: 'exact' });

        if (profileId) {
            queryBuilder = queryBuilder.eq('profile_id', profileId);
        }

        if (req.query.queryId) {
            queryBuilder = queryBuilder.eq('query_id', req.query.queryId);
        }

        if (status) {
            queryBuilder = queryBuilder.eq('status', status);
        }

        if (tab === 'pending') {
            // Pending Proposals Tab: Show only Pending Generation / Pending records
            queryBuilder = queryBuilder.or('status.ilike.pending,current_stage.ilike.pending,status.ilike.pending_generation,current_stage.ilike.pending_generation');
        } else if (tab === 'generated') {
            // Generated Proposals Tab: Show Draft and all workflow stages after Draft.
            // Exclude Pending Generation records.
            queryBuilder = queryBuilder
                .not('status', 'ilike', 'pending')
                .not('current_stage', 'ilike', 'pending')
                .not('status', 'ilike', 'pending_generation')
                .not('current_stage', 'ilike', 'pending_generation');
        }

        if (search) {
            queryBuilder = queryBuilder.ilike('client_name', `%${search}%`);
        }

        const { data, count, error } = await queryBuilder
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Proposals API] Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            data: await resolveProposalUserNames((data || []).map(formatProposal)),
            pagination: {
                total: count || 0,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: count ? Math.ceil(count / limit) : 0
            }
        });
    } catch (error) {
        console.error('[Proposals API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/proposals/temp-clients
router.post('/temp-clients', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { clientName, contactName, contactPhone, contactCountryCode, contactEmail, constitutionId, reference, associateId, createdBy } = req.body;
        
        if (!clientName) {
            return res.status(400).json({ error: 'Client identification (Company or Person Name) is required' });
        }

        // Normalize phone
        const { fullPhone: normalizedPhone, countryCode: normalizedCode } = parsePhoneNumber(
            contactPhone,
            contactCountryCode || '+91'
        );

        const { data, error } = await supabase
            .from('temp_clients')
            .insert({
                client_name: clientName,
                contact_name: contactName || null,
                contact_phone: normalizedPhone || contactPhone || null,
                contact_country_code: normalizedCode,
                contact_email: contactEmail || null,
                constitution_id: constitutionId || null,
                reference: reference || 'Direct',
                associate_id: associateId || null,
                created_by: createdBy || null
            })
            .select()
            .single();

        if (error) {
            console.error('[Proposals API] Temp client creation error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error('[Proposals API] Serious fatal error in POST /temp-clients:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/proposals/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error('[Proposals API] Fetch one error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }

        const formatted = formatProposal(data);
        const [resolved] = await resolveProposalUserNames([formatted]);
        res.json({ success: true, data: resolved });
    } catch (error) {
        console.error('[Proposals API] Fatal internal error in GET /:id:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/proposals
router.post('/', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const p = req.body;

        // Validation
        if (!p.profileId) return res.status(400).json({ error: 'profileId is required' });
        if (!p.clientName) return res.status(400).json({ error: 'clientName is required' });
        if (!p.proposedWork || p.proposedWork.length === 0) {
            return res.status(400).json({ error: 'proposedWork items are required' });
        }

        const now = new Date().toISOString();

        // Normalize contacts[]
        const normalizedContacts = normalizeContactsArray(p.contacts || []);

        const { data, error } = await supabase
            .from('proposals')
            .insert({
                profile_id: p.profileId,
                query_id: p.queryId || null,
                client_id: p.clientId || null,
                temp_client_id: p.tempClientId || null,
                client_name: p.clientName,
                proposed_work: p.proposedWork || [],
                description: p.description || '',
                professional_fee: p.professionalFee || 0,
                government_fee: p.governmentFee || 0,
                gst_percentage: p.gstPercentage || 0,
                gst_target: p.gstTarget || 'None',
                gst_amount: p.gstAmount || 0,
                total_amount: p.totalAmount || 0,
                status: p.status || 'drafted',
                current_stage: p.currentStage || 'drafted',
                proposal_stages: p.proposalStages || [{ name: 'drafted', status: 'Completed', updatedAt: now, updatedBy: p.createdBy }],
                contacts: normalizedContacts,
                follow_ups: p.followUps || [],
                assigned_to: p.assignedTo || null,
                next_follow_up_date: p.nextFollowUpDate || null,
                converted_to_work: p.convertedToWork || false,
                processing_days: p.processingDays || 0,
                processing_hours: p.processingHours || 0,
                phone: p.phone || null,
                email: p.email || null,
                country_code: p.countryCode || '+91',
                no_invoice: p.noInvoice || false,
                discount_type: p.discountType || p.discount_type || 'amount',
                discount_value: Number(p.discountValue ?? p.discount_value ?? 0),
                discount_amount: Number(p.discountAmount ?? p.discount_amount ?? 0),
                total_before_discount: Number(p.totalBeforeDiscount ?? p.total_before_discount ?? p.totalAmount ?? p.total_amount ?? 0),
                created_by: p.createdBy || null,
                updated_at: now
            })
            .select()
            .single();

        if (error) {
            console.error('[Proposals API] Create error:', error);
            return res.status(500).json({ error: error.message });
        }

        // 4. Update Enquiry Status (Requirement 4)
        if (p.queryId) {
            if (!p.isPartialConversion) {
                // FULL CONVERSION: Mark as terminal status
                await supabase
                    .from('queries')
                    .update({ status: 'Proposal Generated' })
                    .eq('id', p.queryId);
            } else if (p.remainingWorkItems) {
                // PARTIAL CONVERSION: Remove converted items from the original enquiry
                await supabase
                    .from('queries')
                    .update({ work_items: p.remainingWorkItems })
                    .eq('id', p.queryId);
            }
        }

        // Log Initial History (Requirement 5)
        await logProposalHistory({
            proposalId: data.id,
            eventType: 'proposal_generated',
            previousStage: 'pending',
            newStage: data.current_stage || 'drafted',
            performedBy: p.createdBy || 'System',
            description: `Proposal generated for ${p.clientName}.`
        });

        const fmtCreated = formatProposal(data);
        const [resolvedCreated] = await resolveProposalUserNames([fmtCreated]);
        res.status(201).json({ success: true, data: resolvedCreated });
    } catch (error) {
        console.error('[Proposals API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/proposals/:id (FULL UPDATE / EDIT)
router.patch('/:id', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { id } = req.params;
        const p = req.body;
        const now = new Date().toISOString();

        const updateData = {
            updated_at: now,
            updated_by: p.updatedBy || null
        };

        // Map allowed fields that exist in the DB (checked)
        if (p.proposedWork !== undefined) updateData.proposed_work = p.proposedWork;
        if (p.professionalFee !== undefined) updateData.professional_fee = p.professionalFee;
        if (p.governmentFee !== undefined) updateData.government_fee = p.governmentFee;
        if (p.gstPercentage !== undefined) updateData.gst_percentage = p.gstPercentage;
        if (p.gstTarget !== undefined) updateData.gst_target = p.gstTarget;
        if (p.gstAmount !== undefined) updateData.gst_amount = p.gstAmount;
        if (p.totalAmount !== undefined) updateData.total_amount = p.totalAmount;
        if (p.description !== undefined) updateData.description = p.description;
        if (p.validity !== undefined) updateData.validity = p.validity;
        if (p.additionalNotes !== undefined) updateData.additional_notes = p.additionalNotes;
        if (p.status !== undefined) updateData.status = p.status;
        if (p.currentStage !== undefined) updateData.current_stage = p.currentStage;
        if (p.assignedTo !== undefined) updateData.assigned_to = p.assignedTo;
        if (p.nextFollowUpDate !== undefined) updateData.next_follow_up_date = p.nextFollowUpDate;
        if (p.convertedToWork !== undefined) updateData.converted_to_work = p.convertedToWork;
        if (p.clientName !== undefined) updateData.client_name = p.clientName;
        if (p.profileId !== undefined) updateData.profile_id = p.profileId;
        if (p.queryId !== undefined) updateData.query_id = p.queryId;
        if (p.clientId !== undefined) updateData.client_id = p.clientId;
        if (p.tempClientId !== undefined) updateData.temp_client_id = p.tempClientId;
        if (p.proposalStages !== undefined) updateData.proposal_stages = p.proposalStages;
        if (p.contacts !== undefined) updateData.contacts = normalizeContactsArray(p.contacts);
        if (p.followUps !== undefined) updateData.follow_ups = p.followUps;
        if (p.processingDays !== undefined) updateData.processing_days = p.processingDays;
        if (p.processingHours !== undefined) updateData.processing_hours = p.processingHours;
        if (p.phone !== undefined) updateData.phone = p.phone;
        if (p.email !== undefined) updateData.email = p.email;
        if (p.countryCode !== undefined) updateData.country_code = p.countryCode;
        if (p.noInvoice !== undefined) updateData.no_invoice = p.noInvoice;
        
        if (p.discountType !== undefined) updateData.discount_type = p.discountType;
        if (p.discountValue !== undefined) updateData.discount_value = p.discountValue;
        if (p.discountAmount !== undefined) updateData.discount_amount = p.discountAmount;
        if (p.totalBeforeDiscount !== undefined) updateData.total_before_discount = p.totalBeforeDiscount;

        if (p.template !== undefined) updateData.template = p.template;
        if (p.generatedDocument !== undefined) updateData.generated_document = p.generatedDocument;

        // ALL columns exist in the table as per latest check.

        const { data, error } = await supabase
            .from('proposals')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Proposals API] Update error:', error);
            // Handle 404 (not found) vs 500
            const status = error.code === 'PGRST116' ? 404 : 500;
            return res.status(status).json({ error: error.message });
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }

        res.json({ success: true, data: formatProposal(data) });
    } catch (error) {
        console.error('[Proposals API] Serious fatal error in PATCH /:id:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/proposals/:id/workflow (WORKFLOW UPDATE)
router.patch('/:id/workflow', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { id } = req.params;
        const { action, payload, performer } = req.body;
        const now = new Date().toISOString();

        // 1. Fetch current state to determine transitions
        const { data: current, error: fetchError } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !current) {
            console.error('[Proposals API] Fetch error:', fetchError);
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }

        let updateData = { 
            updated_at: now,
            updated_by: performer?.id || null
        };
        
        let historyEvent = {
            proposalId: id,
            eventType: action || 'manual_update',
            previousStage: current.current_stage,
            newStage: current.current_stage,
            previousVersion: current.version || '1.0',
            newVersion: current.version || '1.0',
            performedBy: performer?.name || 'System',
            description: `Action: ${action || 'Manual Update'}`
        };

        // 2. Resolve Action Logic
        switch (action) {
            case 'approve':
                // If it's a client revision, move to draft for internal review cycle
                if (current.current_stage === 'Revision Required (Client)' || current.current_stage === 'revision_required') {
                    updateData.current_stage = 'draft';
                    updateData.status = 'Draft';
                    historyEvent.newStage = 'draft';
                    historyEvent.eventType = 'revised_proposal_approved';
                    historyEvent.description = 'Revised proposal approved internally and ready to send to client.';
                } else {
                    updateData.current_stage = 'approved';
                    updateData.approval_status = 'Approved';
                    historyEvent.newStage = 'approved';
                    historyEvent.eventType = 'proposal_approved';
                    historyEvent.description = 'Proposal approved internally';
                    
                    // Capture snapshot on approval
                    await captureTemplateSnapshotIfNeeded(id, current);
                }
                break;

            case 'reject':
                updateData.current_stage = 'draft';
                updateData.approval_status = 'Rejected';
                historyEvent.newStage = 'draft';
                historyEvent.description = 'Proposal rejected internally';
                break;

            case 'send':
                updateData.current_stage = 'sent';
                updateData.sent_at = now;
                updateData.sent_date = payload.sentDate || now.split('T')[0];
                updateData.profile_id = payload.profileId || current.profile_id;
                
                // Update client name if provided and missing
                if (payload.clientName && (!current.client_name || current.client_name === '')) {
                    updateData.client_name = payload.clientName;
                }

                historyEvent.newStage = 'sent';
                historyEvent.eventType = 'proposal_sent';
                historyEvent.description = `Proposal sent to client via ${payload.interactionType || 'Email'} by ${performer?.name || 'Staff'}`;
                historyEvent.metadata = {
                    interactionType: payload.interactionType,
                    contactDetail: payload.contactDetail,
                    clientName: payload.clientName || current.client_name,
                    profileId: payload.profileId,
                    sentDate: payload.sentDate,
                    sentBy: performer?.name,
                    previousStage: current.current_stage,
                    newStage: 'sent'
                };
                
                // Track in send logs
                await supabase.from('proposal_send_logs').insert({
                    proposal_id: id,
                    interaction_method: payload.interactionType,
                    profile_id: payload.profileId,
                    sender_name: performer?.name || 'System',
                    sender_email: payload.senderEmail || '', 
                    sent_at: now,
                    created_by: performer?.id
                });

                // Capture snapshot on send (if not already captured on approval)
                await captureTemplateSnapshotIfNeeded(id, current);
                break;

            case 'accept':
                updateData.current_stage = 'Accepted';
                updateData.status = 'Accepted';
                updateData.converted_to_work = false;
                updateData.conversion_status = 'Not Converted';
                historyEvent.newStage = 'Accepted';
                historyEvent.eventType = 'proposal_accepted';
                historyEvent.description = 'Proposal accepted by client';
                break;

            case 'close':
                updateData.current_stage = 'Closed';
                updateData.status = 'Closed';
                historyEvent.newStage = 'Closed';
                historyEvent.eventType = 'proposal_closed';
                historyEvent.description = 'Proposal closed';
                break;

            case 'convert': {
                // 1. Verify that work entries actually exist for this proposal
                const { data: linkedWorks, error: linkedError } = await supabase
                    .from('works')
                    .select('id')
                    .eq('proposal_id', id)
                    .limit(1);

                if (linkedError) {
                    console.error('[Proposals API] Error verifying linked works:', linkedError);
                    return res.status(500).json({ success: false, error: 'Database verification failed' });
                }

                if (!linkedWorks || linkedWorks.length === 0) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Cannot convert proposal: No linked work entries found. Please save work entries first.' 
                    });
                }

                // 2. Perform atomic update of all conversion fields
                updateData.current_stage = 'Closed';
                updateData.status = 'Closed';
                updateData.converted_to_work = true;
                updateData.conversion_status = 'Converted';
                updateData.converted_at = now;
                updateData.converted_by = performer?.id || null;
                
                historyEvent.newStage = 'Closed';
                historyEvent.eventType = 'proposal_converted';
                historyEvent.description = 'Proposal finalized and converted to work.';

                // Update associated enquiry if linked
                if (current.query_id) {
                    await supabase
                        .from('queries')
                        .update({ status: 'Closed' })
                        .eq('id', current.query_id)
                        .neq('status', 'Dropped');
                }
                break;
            }

            case 'add_work':
                // Check for terminal stage to trigger versioning
                if (current.current_stage === 'closed' || current.current_stage === 'lost' || current.status === 'Closed') {
                    const currentV = parseFloat(current.version || '1.0');
                    const nextV = (currentV + 0.1).toFixed(1);
                    
                    updateData.current_stage = 'revision_pending_approval';
                    updateData.version = String(nextV);
                    updateData.status = 'Draft'; // Reset status for visibility
                    updateData.approval_status = 'Pending Approval';
                    updateData.proposed_work = payload.proposedWork;
                    
                    historyEvent.newStage = 'revision_pending_approval';
                    historyEvent.newVersion = String(nextV);
                    historyEvent.description = `Added more work to closed proposal. Version incremented to ${nextV}. Stage reset for re-approval.`;
                } else {
                    updateData.proposed_work = payload.proposedWork;
                    historyEvent.description = 'Updated services and pricing';
                    // If it was already approved, maybe it needs re-approval?
                    if (current.current_stage === 'approved' || current.current_stage === 'sent') {
                         updateData.current_stage = 'draft';
                         updateData.approval_status = 'Pending Approval';
                         historyEvent.newStage = 'draft';
                         historyEvent.description += ' (Reverted to Draft for re-approval)';
                    }
                }
                break;

            default:
                // Handle legacy or direct updates
                if (payload.currentStage) {
                    updateData.current_stage = payload.currentStage;
                    historyEvent.newStage = payload.currentStage;
                }
                if (payload.status) updateData.status = payload.status;
                if (payload.proposedWork) updateData.proposed_work = payload.proposedWork;
                break;
        }

        // 3. Persist Changes
        const { data, error } = await supabase
            .from('proposals')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Proposals API] Update error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        // 4. Log History asynchronously
        await logProposalHistory({
            ...historyEvent,
            newStage: updateData.current_stage || current.current_stage,
            newVersion: updateData.version || current.version || '1.0'
        });

        const fmtWf = formatProposal(data);
        const [resolvedWf] = await resolveProposalUserNames([fmtWf]);
        res.json({ success: true, data: resolvedWf });
    } catch (error) {
        console.error('[Proposals API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/proposals/:id/followups (APPEND FOLLOW-UP & UPDATE METADATA)
router.patch('/:id/followups', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { id } = req.params;
        const { followUp, stage, nextFollowUpDate, conversionProbability } = req.body;
        const now = new Date().toISOString();

        // Fetch existing
        const { data: proposalData, error: fetchError } = await supabase
            .from('proposals')
            .select('follow_ups, current_stage, proposal_stages')
            .eq('id', id)
            .single();

        if (fetchError) {
             return res.status(fetchError.code === 'PGRST116' ? 404 : 500).json({ success: false, error: fetchError.message });
        }

        const existingFollowUps = proposalData.follow_ups || [];
        const newFollowUps = [...existingFollowUps, followUp];

        const updateData = {
            updated_at: now,
            updated_by: followUp.performedBy || followUp.createdBy || null,
            follow_ups: newFollowUps,
            last_follow_up_date: followUp.date || now.split('T')[0]
        };

        if (nextFollowUpDate !== undefined) updateData.next_follow_up_date = nextFollowUpDate;
        if (conversionProbability !== undefined) updateData.conversion_probability = conversionProbability;
        
        // Handle stage transition if provided
        if (stage && stage !== proposalData.current_stage) {
            updateData.current_stage = stage;
            const existingStages = proposalData.proposal_stages || [];
            updateData.proposal_stages = [...existingStages, {
                name: stage,
                status: 'Completed',
                updatedAt: now,
                updatedBy: followUp.createdBy || 'Unknown'
            }];
        }

        const { data, error } = await supabase
            .from('proposals')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Proposals API] Follow-up update error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        // 5. Log History
        await logProposalHistory({
            proposalId: id,
            eventType: 'INTERACTION',
            previousStage: proposalData.current_stage,
            newStage: updateData.current_stage || proposalData.current_stage,
            performedBy: followUp.createdBy || 'Unknown',
            description: `Follow-up logged: ${followUp.followUpOutcome || 'Engagement recorded'}`,
            metadata: { followUpId: followUp.id, outcome: followUp.followUpOutcome }
        });

        const formatted = formatProposal(data);
        const [resolved] = await resolveProposalUserNames([formatted]);
        res.json({ success: true, data: resolved });
    } catch (error) {
        console.error('[Proposals API] Internal error in followups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/proposals/:id/revise
router.post('/:id/revise', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { id } = req.params;
        const p = req.body;
        const now = new Date().toISOString();

        // 1. Fetch current state for snapshotting
        const { data: current, error: fetchError } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !current) {
            return res.status(404).json({ error: 'Proposal not found' });
        }

        // 2. Calculate new version (Requirement 4)
        const currentVersion = current.version || '1.0';
        let v = currentVersion.toLowerCase().startsWith('v') ? currentVersion.substring(1) : currentVersion;
        if (!v || v === 'undefined') v = '1.0';
        
        const parts = v.split('.');
        const major = parseInt(parts[0], 10) || 1;
        const minor = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
        const nextVersion = `v${major}.${minor + 1}`;

        // 3. Detect changes (Requirement 2.4)
        const changedFields = getChangedFields(current, {
            proposed_work: p.proposedWork,
            professional_fee: p.professionalFee,
            government_fee: p.governmentFee,
            gst_amount: p.gstAmount,
            total_amount: p.totalAmount,
            description: p.description,
            processing_days: p.processingDays,
            processing_hours: p.processingHours,
            client_name: p.clientName,
            email: p.email,
            country_code: p.countryCode,
            no_invoice: p.noInvoice,
            discount_type: p.discountType,
            discount_value: p.discountValue,
            discount_amount: p.discountAmount,
            total_before_discount: p.totalBeforeDiscount
        });

        const nextStage = 'Revision Required (Client)';

        // 4. Prepare revision log entry
        const revisionEntry = {
            proposal_id: id,
            revision_number: minor + 1,
            previous_version: currentVersion,
            new_version: nextVersion,
            previous_stage: current.current_stage,
            new_stage: nextStage,
            client_requested_changes: p.clientRequestedChanges,
            previous_snapshot: current,
            revised_snapshot: { 
                ...current, 
                proposed_work: p.proposedWork,
                professional_fee: p.professionalFee,
                government_fee: p.governmentFee,
                gst_amount: p.gstAmount,
                total_amount: p.totalAmount,
                description: p.description,
                contacts: p.contacts,
                processing_days: p.processingDays,
                processing_hours: p.processingHours,
                version: nextVersion, 
                current_stage: nextStage,
                phone: p.phone,
                email: p.email,
                country_code: p.countryCode,
                no_invoice: p.noInvoice,
                discount_type: p.discountType,
                discount_value: p.discountValue,
                discount_amount: p.discountAmount,
                total_before_discount: p.totalBeforeDiscount,
                total_amount: p.totalAmount
            },
            changed_fields: changedFields,
            revised_by: p.revisedBy,
            revised_at: now
        };

        // 5. Update Proposal
        const updateData = {
            proposed_work: p.proposedWork,
            professional_fee: p.professionalFee,
            government_fee: p.governmentFee,
            gst_amount: p.gstAmount,
            total_amount: p.totalAmount,
            description: p.description,
            contacts: p.contacts,
            processing_days: p.processingDays,
            processing_hours: p.processingHours,
            phone: p.phone,
            email: p.email,
            country_code: p.countryCode,
            no_invoice: p.noInvoice,
            discount_type: p.discountType,
            discount_value: p.discountValue,
            discount_amount: p.discountAmount,
            total_before_discount: p.totalBeforeDiscount,
            version: nextVersion,
            current_stage: nextStage,
            status: 'Revision Required',
            updated_at: now,
            updated_by: p.revisedBy || null
        };

        const { data: updated, error: updateError } = await supabase
            .from('proposals')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        // 6. Insert Revision Log
        await supabase
            .from('proposal_revisions')
            .insert(revisionEntry);

        // 7. Log to History
        await logProposalHistory({
            proposalId: id,
            eventType: 'client_revision_submitted',
            previousStage: current.current_stage,
            newStage: nextStage,
            previousVersion: currentVersion,
            newVersion: nextVersion,
            performedBy: p.revisedBy || 'System',
            description: `Client requested changes. Version incremented to ${nextVersion}.`,
            metadata: { 
                clientRequestedChanges: p.clientRequestedChanges,
                changedFields: changedFields
            }
        });

        const formatted = formatProposal(updated);
        const [resolved] = await resolveProposalUserNames([formatted]);
        res.json({ success: true, data: resolved });

    } catch (error) {
        console.error('[Proposals API] Revision error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/proposals/:id
router.delete('/:id', requirePermission('MANAGE_PROPOSALS'), async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('proposals')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('[Proposals API] Delete error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: 'Proposal deleted successfully' });
    } catch (error) {
        console.error('[Proposals API] Internal error in DELETE /:id:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/proposals/:id/history
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch follow-ups from proposal
        const { data: proposal, error: pError } = await supabase
            .from('proposals')
            .select('follow_ups, current_stage, version')
            .eq('id', id)
            .single();

        if (pError) throw pError;

        // Fetch history logs
        const { data: history, error: hError } = await supabase
            .from('proposal_history')
            .select('*')
            .eq('proposal_id', id)
            .order('performed_at', { ascending: false })
            .limit(100);

        if (hError) throw hError;

        // Fetch revision details
        const { data: revisions, error: rError } = await supabase
            .from('proposal_revisions')
            .select('*')
            .eq('proposal_id', id)
            .order('revised_at', { ascending: false })
            .limit(50);

        if (rError) throw rError;

        // Merge and format (Requirement 1)
        res.json({ 
            success: true, 
            data: {
                interactions: (proposal.follow_ups || []).map(f => ({
                    ...f,
                    type: 'interaction',
                    timestamp: f.date || f.createdAt
                })),
                history: (history || []).map(h => ({
                    ...h,
                    type: 'history',
                    timestamp: h.created_at
                })),
                revisions: (revisions || []).map(r => ({
                    ...r,
                    type: 'revision',
                    timestamp: r.revised_at
                }))
            }
        });

    } catch (error) {
        console.error('[Proposals API] History error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/proposals/:id/template
router.get('/:id/template', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: proposal, error } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !proposal) {
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }

        const formatted = formatProposal(proposal);
        const [resolvedProposal] = await resolveProposalUserNames([formatted]);
        
        // Use ProposalTemplateContextService
        const ctx = await ProposalTemplateContextService.buildProposalTemplateContext(id);
        const baseContext = ctx.renderContext;
        

        const resolvedTemplate = await resolveProposalTemplate(proposal);

        if (!resolvedTemplate) {
            return res.json({ 
                success: false, 
                error: 'No matching template configuration found.',
                fallbackContext: baseContext
            });
        }

        // Freeze template snapshot on first download
        if (!proposal.template_snapshot) {
            await captureTemplateSnapshotIfNeeded(id, proposal);
        }

        // We have a template and mappings (but we ignore them for Proposals as per requirements)
        let mappedContext = { ...baseContext };

        res.json({
            success: true,
            data: {
                source: resolvedTemplate.source,
                template_id: resolvedTemplate.template_id,
                configuration_id: resolvedTemplate.configuration_id,
                template_name: resolvedTemplate.template_name,
                template_content: resolvedTemplate.template_content,
                context: mappedContext
            }
        });

    } catch (err) {
        console.error('[Proposals API] Template fetch error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
