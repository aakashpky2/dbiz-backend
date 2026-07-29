const { supabase } = require('../lib/supabase');
const RBACService = require('../services/rbacService');

exports.assignResponsibility = async (req, res) => {
    try {
        const { targetUserIds = [], responsibilityTemplateId, reason, validUntil } = req.body;
        
        if (!targetUserIds.length || !responsibilityTemplateId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Ideally wrapped in a transaction if supabase RPC is available. For now we use promise all,
        // but bulk requires either an RPC or a single insert.
        // `insert` with an array of objects is atomic in PostgREST!
        const payload = targetUserIds.map(uid => ({
            user_id: uid,
            responsibility_template_id: responsibilityTemplateId,
            assigned_by: req.user.id,
            reason,
            valid_until: validUntil || null
        }));

        const { data, error } = await supabase
            .from('user_responsibilities')
            .insert(payload)
            .select();

        if (error) throw error;

        // Log audit for each
        const auditPayload = targetUserIds.map(uid => ({
            target_user_id: uid,
            action: 'BULK_RESPONSIBILITY_ASSIGNED',
            performed_by: req.user.id,
            reason: reason || 'Bulk assignment',
            new_permission_set: { templateId: responsibilityTemplateId }
        }));
        await supabase.from('permission_audit_logs').insert(auditPayload);

        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.removeResponsibility = async (req, res) => {
    try {
        const { targetUserIds = [], responsibilityTemplateId, reason } = req.body;
        
        if (!targetUserIds.length || !responsibilityTemplateId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabase
            .from('user_responsibilities')
            .delete()
            .in('user_id', targetUserIds)
            .eq('responsibility_template_id', responsibilityTemplateId)
            .select();

        if (error) throw error;

        // Log audit
        const auditPayload = targetUserIds.map(uid => ({
            target_user_id: uid,
            action: 'BULK_RESPONSIBILITY_REMOVED',
            performed_by: req.user.id,
            reason: reason || 'Bulk removal',
            previous_permission_set: { templateId: responsibilityTemplateId }
        }));
        await supabase.from('permission_audit_logs').insert(auditPayload);

        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.applyOverrides = async (req, res) => {
    try {
        const { targetUserIds = [], permissionKey, effect, reason, validUntil } = req.body;
        
        if (!targetUserIds.length || !permissionKey || !['ALLOW', 'DENY'].includes(effect)) {
            return res.status(400).json({ error: 'Missing or invalid fields' });
        }

        const payload = targetUserIds.map(uid => ({
            user_id: uid,
            permission_key: permissionKey,
            effect,
            granted_by: req.user.id,
            reason,
            valid_until: validUntil || null
        }));

        const { data, error } = await supabase
            .from('user_permission_overrides')
            .insert(payload)
            .select();

        if (error) throw error;

        // Log audit
        const auditPayload = targetUserIds.map(uid => ({
            target_user_id: uid,
            action: 'BULK_OVERRIDE_APPLIED',
            performed_by: req.user.id,
            reason: reason || 'Bulk override',
            new_permission_set: { permissionKey, effect }
        }));
        await supabase.from('permission_audit_logs').insert(auditPayload);

        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.removeOverrides = async (req, res) => {
    try {
        const { targetUserIds = [], permissionKey, reason } = req.body;
        
        if (!targetUserIds.length || !permissionKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabase
            .from('user_permission_overrides')
            .delete()
            .in('user_id', targetUserIds)
            .eq('permission_key', permissionKey)
            .select();

        if (error) throw error;

        // Log audit
        const auditPayload = targetUserIds.map(uid => ({
            target_user_id: uid,
            action: 'BULK_OVERRIDE_REMOVED',
            performed_by: req.user.id,
            reason: reason || 'Bulk override removal',
            previous_permission_set: { permissionKey }
        }));
        await supabase.from('permission_audit_logs').insert(auditPayload);

        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
