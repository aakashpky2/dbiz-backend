const { supabase } = require('../lib/supabase');
const RBACService = require('../services/rbacService');

/**
 * Express middleware to authorize users based on RBAC v2.
 * @param {string} requiredPermission - The permission key required to access the route.
 */
function requireRbacPermission(requiredPermission) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?.uid;
      
      console.log(`[requireRbacPermission] Route: ${req.path}, ReqUserUid: ${userId}, Required: ${requiredPermission}`);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: No user session' });
      }

      // 1. Check bootstrap owner access
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('uid, is_owner_super_admin')
        .eq('uid', userId)
        .maybeSingle(); // Changed to maybeSingle to avoid 406 error if multiple/none
        
      if (error) {
        console.error('[requireRbacPermission] Error fetching profile:', error);
        return res.status(500).json({ error: 'Failed to verify user profile' });
      }

      console.log(`[requireRbacPermission] Fetched Profile: uid=${profile?.uid}, is_owner_super_admin=${profile?.is_owner_super_admin}`);

      if (profile?.is_owner_super_admin === true) {
        // Owner bootstrap access granted
        console.log(`[requireRbacPermission] BYPASS: Owner Super Admin allowed`);
        return next();
      }

      // 2. Normal RBAC resolution
      console.log(`[requireRbacPermission] No bypass. Falling back to RBACService resolution...`);
      const resolution = await RBACService.getUserAccessResolution(userId);
      const resolvedPerms = resolution.permissions || [];
      console.log(`[requireRbacPermission] Resolved Perms count: ${resolvedPerms.length}`);
      
      if (resolvedPerms.includes(requiredPermission)) {
        console.log(`[requireRbacPermission] ALLOWED via resolved permission`);
        return next();
      }

      // 3. Deny if neither matches
      console.log(`[requireRbacPermission] DENIED: Missing permission`);
      return res.status(403).json({ error: `Forbidden: Missing required permission ${requiredPermission}` });

    } catch (error) {
      console.error('[requireRbacPermission] Error:', error);
      return res.status(500).json({ 
        success: false, 
        code: error.code || 'INTERNAL_ERROR',
        message: 'Internal server error during authorization',
        details: error.message || error
      });
    }
  };
}

module.exports = requireRbacPermission;
