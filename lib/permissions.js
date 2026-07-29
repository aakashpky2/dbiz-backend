const { supabase } = require('./supabase');
const RBACService = require('../services/rbacService');

// In-memory cache for RBAC resolution
const rbacCache = new Map();
const CACHE_TTL_MS = 60000; // 60 seconds

function getCachedResolution(uid) {
    const entry = rbacCache.get(uid);
    if (entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS) {
        return entry.data;
    }
    return null;
}

function setCachedResolution(uid, data) {
    rbacCache.set(uid, {
        data,
        timestamp: Date.now()
    });
}

/**
 * Fetch the user's profile from the database.
 */
async function getUserProfile(uid) {
    if (!uid) return null;
    try {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('uid', uid)
            .maybeSingle();
        if (error) throw error;
        return data;
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return null;
    }
}

/**
 * Fetch the user's assigned roles from the system_roles table based on their profile.
 */
async function getUserRoles(uid) {
    const profile = await getUserProfile(uid);
    if (!profile || !profile.role_ids || !Array.isArray(profile.role_ids) || profile.role_ids.length === 0) {
        return [];
    }

    try {
        const { data: roles, error } = await supabase
            .from('system_roles')
            .select('*')
            .in('id', profile.role_ids);
        
        if (error) throw error;
        return roles || [];
    } catch (e) {
        console.error("Error fetching user roles:", e);
        return [];
    }
}

/**
 * Checks if a user is an Owner Super Admin.
 */
async function isOwnerSuperAdmin(uid) {
    const profile = await getUserProfile(uid);
    return profile ? profile.is_owner_super_admin === true : false;
}

/**
 * Checks if a user is a Super Admin (priority 1 or name includes super admin).
 */
async function isSuperAdmin(uid) {
    const isOwner = await isOwnerSuperAdmin(uid);
    if (isOwner) return true;

    const roles = await getUserRoles(uid);
    return roles.some(r => r.priority === 1 || (r.name && r.name.toLowerCase().includes('super admin')));
}

/**
 * Merges all permissions from the user's assigned roles.
 */
async function getMergedPermissions(uid) {
    const roles = await getUserRoles(uid);
    const perms = new Set();
    roles.forEach(role => {
        if (Array.isArray(role.permissions)) {
            role.permissions.forEach(p => perms.add(p));
        }
    });
    return Array.from(perms);
}

/**
 * Core permission check function.
 * Evaluates bypasses (Owner Super Admin, Super Admin) first.
 * Then checks if the specific permission ID exists in the merged permissions.
 */
async function hasPermission(uid, permissionId) {
    if (!uid || !permissionId) return false;

    try {
        const profile = await getUserProfile(uid);
        
        console.log(`[hasPermission] uid=${uid}, is_owner_super_admin=${profile?.is_owner_super_admin}`);
        
        if (!profile) return false;

        // 1. Owner Super Admin Bypass
        if (profile.is_owner_super_admin === true) {
            console.log(`[hasPermission] BYPASS: Owner Super Admin`);
            return true;
        }

        // 2. Fetch full RBAC v2 resolution (cached for 60s to prevent DB hammering)
        let resolution = getCachedResolution(uid);
        if (!resolution) {
            console.log(`[hasPermission] Resolving via RBACService for ${uid}`);
            resolution = await RBACService.getUserAccessResolution(uid);
            setCachedResolution(uid, resolution);
        }

        console.log(`[hasPermission] Resolved Roles:`, (resolution.roles || []).map(r => r.name));
        
        // 3. Super Admin bypass check (using resolved roles)
        const roles = resolution.roles || [];
        const _isSuperAdmin = roles.some(r => r.priority === 1 || (r.name && r.name.toLowerCase().includes('super admin')));
        if (_isSuperAdmin) {
            // Except for owner specific controls
            if (permissionId === 'OWNER_SUPER_ADMIN_CONTROLS') return false;
            console.log(`[hasPermission] BYPASS: Super Admin`);
            return true;
        }

        // 4. Check effective permissions from RBAC v2 resolver
        const resolvedPerms = resolution.permissions || [];
        console.log(`[hasPermission] Resolved Permissions Count: ${resolvedPerms.length}`);
        
        if (resolvedPerms.includes(permissionId)) {
            console.log(`[hasPermission] ALLOWED via resolved permission: ${permissionId}`);
            return true;
        }

        console.log(`[hasPermission] DENIED: Missing permission ${permissionId}`);
        return false;
    } catch (e) {
        console.error("[hasPermission] Exception Error:", e);
        return false;
    }
}

/**
 * Express middleware to enforce a required permission on a route.
 */
function requirePermission(permissionId) {
    return async (req, res, next) => {
        // Resolve uid strictly from the cryptographically verified user object (req.user)
        const uid = req.user?.id || req.user?.uid;
        
        console.log(`[requirePermission] Route: ${req.path}, ReqUserUid: ${uid}, Required: ${permissionId}`);
        console.log(`[requirePermission] req.user.is_owner_super_admin: ${req.user?.is_owner_super_admin}, isOwnerSuperAdmin: ${req.user?.isOwnerSuperAdmin}`);
        
        if (!uid) {
            return res.status(401).json({ error: 'Unauthorized: Authenticated user identity missing' });
        }

        const allowed = await hasPermission(uid, permissionId);
        
        console.log(`[requirePermission] Final Result: ${allowed}`);
        
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }

        next();
    };
}

module.exports = {
    getUserProfile,
    getUserRoles,
    getMergedPermissions,
    isSuperAdmin,
    isOwnerSuperAdmin,
    hasPermission,
    requirePermission
};
