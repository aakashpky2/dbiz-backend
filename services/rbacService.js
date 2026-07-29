const { supabase } = require('../lib/supabase');
const { resolveEffectivePermissions } = require('../shared/rbac/resolver');
const { canDelegate } = require('../shared/rbac/delegation');

class RBACService {
  /**
   * Fetches the raw state for a user and calculates the effective permissions using the resolver.
   */
  static async getUserAccessResolution(userId) {
    console.log(`[RBACService] Starting getUserAccessResolution for ${userId}`);
    
    // 1. Fetch User Profile
    let profile;
    try {
      console.log(`[RBACService] Step 1: Fetching profile`);
      const { data, error } = await supabase
        .from('user_profiles')
        .select('uid, is_owner_super_admin, permission_version, role_ids')
        .eq('uid', userId)
        .single();
      if (error) throw error;
      profile = data;
    } catch (e) {
      console.error(`[RBACService] Error in Step 1 (Profile):`, e.message || e);
      throw e;
    }

    // 2. Fetch Assigned Roles
    let roles = [];
    try {
      console.log(`[RBACService] Step 2: Fetching roles based on role_ids`);
      if (profile.role_ids && Array.isArray(profile.role_ids) && profile.role_ids.length > 0) {
        const { data, error } = await supabase
          .from('system_roles')
          .select('id, name, permissions')
          .in('id', profile.role_ids);
        if (error) throw error;
        roles = data || [];
      }
    } catch (e) {
      console.error(`[RBACService] Error in Step 2 (Roles):`, e.message || e);
      throw e;
    }

    // 3. Fetch Assigned Responsibilities (Direct and Role-Based)
    let userRespData = [];
    try {
      console.log(`[RBACService] Step 3: Fetching user responsibilities`);
      const { data, error } = await supabase
        .from('user_responsibilities')
        .select('responsibility_template_id, id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .or('valid_until.is.null,valid_until.gt.now()');
      if (error) throw error;
      userRespData = data || [];
    } catch (e) {
      console.error(`[RBACService] Error in Step 3 (User Responsibilities):`, e.message || e);
      throw e;
    }

    let roleRespData = [];
    try {
      console.log(`[RBACService] Step 4: Fetching role responsibilities`);
      if (roles.length > 0) {
        const { data, error } = await supabase
          .from('role_responsibilities')
          .select('responsibility_template_id')
          .in('role_id', roles.map(r => r.id));
        if (error) throw error;
        roleRespData = data || [];
      }
    } catch (e) {
      console.error(`[RBACService] Error in Step 4 (Role Responsibilities):`, e.message || e);
      throw e;
    }

    const assignedTemplates = Array.from(new Set([
      ...userRespData.map(r => r.responsibility_template_id),
      ...roleRespData.map(r => r.responsibility_template_id)
    ]));

    // 4. Fetch Overrides
    let overrides = [];
    try {
      console.log(`[RBACService] Step 5: Fetching overrides`);
      const { data, error } = await supabase
        .from('user_permission_overrides')
        .select('permission_key, effect, valid_until')
        .eq('user_id', userId)
        .eq('is_active', true)
        .or('valid_until.is.null,valid_until.gt.now()');
      if (error) throw error;
      overrides = data || [];
    } catch (e) {
      console.error(`[RBACService] Error in Step 5 (Overrides):`, e.message || e);
      throw e;
    }

    // 5. Fetch Scopes
    let scopesData = [];
    try {
      console.log(`[RBACService] Step 6: Fetching scopes`);
      if (userRespData.length > 0) {
        const { data, error } = await supabase
          .from('user_responsibility_scopes')
          .select('permission_key, scope_type, scope_values, valid_until, user_responsibility_id')
          .in('user_responsibility_id', userRespData.map(r => r.id)) // Simplified for now
          .eq('is_active', true)
          .or('valid_until.is.null,valid_until.gt.now()');
        if (error) throw error;
        scopesData = data || [];
      }
    } catch (e) {
      console.error(`[RBACService] Error in Step 6 (Scopes):`, e.message || e);
      throw e;
    }

    // 6. Fetch all required template definitions
    let templateDefinitions = {};
    try {
      console.log(`[RBACService] Step 7: Fetching template definitions for templates:`, assignedTemplates);
      templateDefinitions = await this.buildTemplateDefinitions(assignedTemplates);
    } catch (e) {
      console.error(`[RBACService] Error in Step 7 (Template Definitions):`, e.message || e);
      throw e;
    }

    let resolution = {};
    try {
      console.log(`[RBACService] Step 8: Resolving effective permissions`);
      resolution = resolveEffectivePermissions({
        isOwnerSuperAdmin: profile.is_owner_super_admin,
        roles,
        assignedTemplates,
        templateDefinitions,
        overrides,
        activeScopes: scopesData
      });
    } catch (e) {
      console.error(`[RBACService] Error in Step 8 (Resolver):`, e.message || e);
      throw e;
    }

    console.log(`[RBACService] Resolution complete for ${userId}`);
    return {
      permissionVersion: profile.permission_version,
      ...resolution
    };
  }

  /**
   * Recursively fetch templates and their permissions and child templates.
   */
  static async buildTemplateDefinitions(initialTemplateIds) {
    const definitions = {};
    const queue = [...initialTemplateIds];
    const visited = new Set();

    while (queue.length > 0) {
      const tId = queue.shift();
      if (visited.has(tId)) continue;
      visited.add(tId);

      const { data: perms } = await supabase
        .from('responsibility_template_permissions')
        .select('permission_key')
        .eq('responsibility_template_id', tId);

      const { data: deps } = await supabase
        .from('responsibility_template_dependencies')
        .select('child_template_id')
        .eq('parent_template_id', tId);

      definitions[tId] = {
        permissions: perms ? perms.map(p => p.permission_key) : [],
        childTemplates: deps ? deps.map(d => d.child_template_id) : []
      };

      if (deps) {
        deps.forEach(d => queue.push(d.child_template_id));
      }
    }

    return definitions;
  }

  static async incrementPermissionVersion(userId) {
    const { error } = await supabase.rpc('increment_permission_version', { target_uid: userId });
    // Or if rpc not available:
    // await supabase.from('user_profiles').update({ permission_version: ... }).eq('uid', userId);
    if (error) {
       const { data: p } = await supabase.from('user_profiles').select('permission_version').eq('uid', userId).single();
       if (p) {
         await supabase.from('user_profiles').update({ permission_version: p.permission_version + 1 }).eq('uid', userId);
       }
    }
  }

  static async logAudit(entry) {
    await supabase.from('permission_audit_logs').insert([entry]);
  }
}

module.exports = RBACService;
