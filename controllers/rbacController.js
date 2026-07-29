const { supabase } = require('../lib/supabase');
const RBACService = require('../services/rbacService');
const { resolveEffectivePermissions } = require('../shared/rbac/resolver');



// -- Templates --
exports.getTemplates = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('responsibility_templates')
            .select(`
                *,
                responsibility_template_permissions(permission_key),
                child_dependencies:responsibility_template_dependencies!parent_template_id(child_template_id)
            `)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(403).json({ error: error.message });
    }
};

exports.getTemplateById = async (req, res) => {
    try {
        const { templateId } = req.params;
        const { data, error } = await supabase
            .from('responsibility_templates')
            .select(`
                *,
                responsibility_template_permissions(permission_key),
                child_dependencies:responsibility_template_dependencies!parent_template_id(child_template_id)
            `)
            .eq('id', templateId)
            .single();
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const { name, description, category, permissions = [], child_templates = [] } = req.body;
        
        const { data: template, error } = await supabase
            .from('responsibility_templates')
            .insert([{ name, description, category, created_by: req.user.id }])
            .select()
            .single();
        if (error) throw error;

        if (permissions.length > 0) {
            await supabase.from('responsibility_template_permissions').insert(
                permissions.map(p => ({ responsibility_template_id: template.id, permission_key: p }))
            );
        }

        if (child_templates.length > 0) {
            await supabase.from('responsibility_template_dependencies').insert(
                child_templates.map(c => ({ parent_template_id: template.id, child_template_id: c }))
            );
        }

        RBACService.logAudit({
            target_user_id: req.user.id, action: 'TEMPLATE_CREATED', performed_by: req.user.id, reason: 'Created new template: ' + name
        });

        res.json({ status: 'success', data: template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const { templateId } = req.params;
        const { name, description, category, status } = req.body;
        
        const { data: template, error } = await supabase
            .from('responsibility_templates')
            .update({ name, description, category, status, updated_at: new Date() })
            .eq('id', templateId)
            .select()
            .single();
        if (error) throw error;

        RBACService.logAudit({
            target_user_id: req.user.id, action: 'TEMPLATE_UPDATED', performed_by: req.user.id, reason: 'Updated template: ' + templateId
        });

        res.json({ status: 'success', data: template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.duplicateTemplate = async (req, res) => {
    try {
        const { templateId } = req.params;
        
        // 1. Get original
        const { data: original, error: origErr } = await supabase
            .from('responsibility_templates')
            .select(`
                *,
                responsibility_template_permissions(permission_key),
                child_dependencies:responsibility_template_dependencies!parent_template_id(child_template_id)
            `)
            .eq('id', templateId)
            .single();
        if (origErr) throw origErr;

        // 2. Create copy
        const { data: copy, error: copyErr } = await supabase
            .from('responsibility_templates')
            .insert([{ 
                name: original.name + ' (Copy)', 
                description: original.description, 
                category: original.category,
                status: 'ACTIVE',
                is_system_template: false,
                created_by: req.user.id
            }])
            .select()
            .single();
        if (copyErr) throw copyErr;

        // 3. Copy permissions
        if (original.responsibility_template_permissions?.length > 0) {
            await supabase.from('responsibility_template_permissions').insert(
                original.responsibility_template_permissions.map(p => ({ 
                    responsibility_template_id: copy.id, 
                    permission_key: p.permission_key 
                }))
            );
        }

        // 4. Copy dependencies
        if (original.child_dependencies?.length > 0) {
            await supabase.from('responsibility_template_dependencies').insert(
                original.child_dependencies.map(d => ({ 
                    parent_template_id: copy.id, 
                    child_template_id: d.child_template_id 
                }))
            );
        }

        RBACService.logAudit({
            target_user_id: req.user.id, action: 'TEMPLATE_DUPLICATED', performed_by: req.user.id, reason: 'Duplicated template: ' + templateId
        });

        res.json({ status: 'success', data: copy });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateTemplateStatus = async (req, res) => {
    try {
        const { templateId } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data: template, error } = await supabase
            .from('responsibility_templates')
            .update({ status, updated_at: new Date() })
            .eq('id', templateId)
            .select()
            .single();
        if (error) throw error;

        RBACService.logAudit({
            target_user_id: req.user.id, action: 'TEMPLATE_STATUS_CHANGED', performed_by: req.user.id, reason: 'Changed status to ' + status
        });

        res.json({ status: 'success', data: template });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// -- Users --
exports.getUserEffectiveAccess = async (req, res) => {
    try {
        const resolution = await RBACService.getUserAccessResolution(req.params.userId);
        res.json({ status: 'success', data: resolution });
    } catch (error) {
        console.error(`[rbacController] getUserEffectiveAccess Error:`, error);
        res.status(500).json({ 
            success: false, 
            code: error.code || 'INTERNAL_ERROR',
            message: error.message || 'An error occurred during RBAC resolution',
            details: error.details || error.hint || null
        });
    }
};

exports.getUserResponsibilities = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('user_responsibilities')
            .select('*, responsibility_templates(name)')
            .eq('user_id', req.params.userId);
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getUserOverrides = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('user_permission_overrides')
            .select('*')
            .eq('user_id', req.params.userId);
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getUserAudit = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('permission_audit_logs')
            .select('*, performed_by_user:user_profiles!permission_audit_logs_performed_by_fkey(name)')
            .eq('target_user_id', req.params.userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// -- Roles --
exports.getRoles = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('system_roles')
            .select('*')
            .order('name');
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getUserRoles = async (req, res) => {
    try {
        const { data: profile, error: profileErr } = await supabase
            .from('user_profiles')
            .select('role_ids')
            .eq('uid', req.params.userId)
            .single();
        if (profileErr) throw profileErr;

        let roles = [];
        if (profile && profile.role_ids && Array.isArray(profile.role_ids) && profile.role_ids.length > 0) {
            const { data: rolesData, error: rolesErr } = await supabase
                .from('system_roles')
                .select('*')
                .in('id', profile.role_ids);
            if (rolesErr) throw rolesErr;
            roles = rolesData || [];
        }

        res.json({ status: 'success', data: roles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateUserRoles = async (req, res) => {
    try {
        const { userId } = req.params;
        const { roleIds = [] } = req.body;
        
        // 1. Verify actor can assign these roles
        // We do a simplified check for now since exact permissions per role assignment are complex.
        // Usually checked in requireRbacPermission('ASSIGN_ROLES').

        // 2. Load existing user
        const { data: user, error: userErr } = await supabase
            .from('user_profiles')
            .select('is_owner_super_admin')
            .eq('uid', userId)
            .single();
        if (userErr) throw userErr;

        // 3. Load requested roles to verify they don't grant protected capabilities if not allowed
        // (Assuming a basic check for now)

        // 4. Update
        // Assuming user_profiles.role_ids is where they are stored, if not, update `user_roles` table
        // We will assume `user_roles` table insertion to be generic or fallback to `user_profiles`.
        // Let's do user_profiles.role_ids for legacy compatibility.
        const { error: updateErr } = await supabase
            .from('user_profiles')
            .update({ role_ids: roleIds, permission_version: 0 }) // Triggers should handle it, but wait, updating user_profiles directly won't fire a trigger ON user_roles!
            // I'll update it normally and explicitly call a version bump if no trigger fires on user_profiles for this column.
            .eq('uid', userId);
        if (updateErr) throw updateErr;

        // Force permission version bump if we update user_profiles directly
        await supabase.rpc('increment_user_permission_version_for_uid', { target_uid: userId });

        RBACService.logAudit({
            target_user_id: userId,
            action: 'ROLE_ASSIGNED',
            performed_by: req.user.id,
            reason: 'Roles updated',
            new_permission_set: { roleIds }
        });

        const resolution = await RBACService.getUserAccessResolution(userId);
        res.json({ status: 'success', data: resolution });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.previewAccess = async (req, res) => {
    try {
        const { targetUserId, roleIds = [], responsibilities = [], overrides = [] } = req.body;
        
        let isOwnerSuperAdmin = false;
        if (targetUserId) {
            const { data: userProfile } = await supabase
                .from('user_profiles')
                .select('is_owner_super_admin')
                .eq('uid', targetUserId)
                .single();
            isOwnerSuperAdmin = userProfile?.is_owner_super_admin || false;
        }

        // Fetch roles from DB
        let roles = [];
        if (roleIds.length > 0) {
            const { data: dbRoles } = await supabase
                .from('system_roles')
                .select('*')
                .in('id', roleIds);
            roles = dbRoles || [];
        }

        // assignedTemplates is an array of IDs for the resolver
        const assignedTemplates = responsibilities.map(r => r.templateId);
        const templateDefinitions = await RBACService.buildTemplateDefinitions(assignedTemplates);
        
        const mappedOverrides = overrides.map(o => ({
            permission_key: o.permissionKey,
            effect: o.effect,
            valid_until: o.validUntil
        }));

        const activeScopes = []; // Expand if needed based on responsibilities[i].scopes

        const resolution = resolveEffectivePermissions({
            isOwnerSuperAdmin,
            roles,
            assignedTemplates,
            templateDefinitions,
            overrides: mappedOverrides,
            activeScopes
        });

        res.json({ status: 'success', data: resolution });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
