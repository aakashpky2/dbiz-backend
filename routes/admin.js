const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');
const { hasPermission } = require('../lib/permissions');
const { normalizePhoneNumber } = require('../lib/phone');

/**
 * Resolve display name for an auth uid (user_profiles.uid).
 * adminId/requesterId passed from frontend is the auth uid, NOT employees.id.
 */
async function getPerformedByName(requesterUid) {
    if (!requesterUid) return 'Admin';
    try {
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('display_name, full_name, email, employee_id')
            .eq('uid', requesterUid)
            .maybeSingle();

        // Prefer profile names if present
        const profileName = profile?.display_name || profile?.full_name;
        if (profileName) return profileName;

        // Fallback to employee name via employee_id link
        if (profile?.employee_id) {
            const { data: emp } = await supabase
                .from('employees')
                .select('full_name, name, email')
                .eq('id', profile.employee_id)
                .maybeSingle();
            const empName = emp?.full_name || emp?.name;
            if (empName) return empName;
        }

        // Last resort: email prefix or generic
        if (profile?.email) return profile.email;
        return 'Admin';
    } catch (e) {
        console.error("Error resolving performed_by_name:", e);
        return 'Admin';
    }
}

const MOBILE_REQUIRED_ERROR = 'Employee mobile number is required to create login credentials.';

function temporaryPasswordFromPhone(phone) {
    const digits = normalizePhoneNumber(phone);
    return digits.length === 10 ? digits : null;
}

/**
 * Helper to get the highest role priority (lowest number) for a user by their UID.
 * Default is 10 if no roles are found.
 */
async function getUserPriority(uid) {
    if (!uid) return 10;
    try {
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('role_ids, is_owner_super_admin')
            .eq('uid', uid)
            .maybeSingle();

        if (!profile) return 10;
        if (profile.is_owner_super_admin) return 1;

        if (!profile.role_ids || profile.role_ids.length === 0) {
            return 10;
        }

        // Fetch priorities from system_roles strictly by UUID
        const { data: roles } = await supabase
            .from('system_roles')
            .select('priority')
            .in('id', profile.role_ids);

        if (!roles || roles.length === 0) {
            return 10;
        }

        return Math.min(...roles.map(r => r.priority ?? 10));
    } catch (e) {
        console.error("Error getting user priority:", e);
        return 10;
    }
}

/**
 * Enforce strict role hierarchy check.
 * Requester priority must be lower number (higher privilege) than target priority.
 * Admins (priority 2) cannot edit other Admins (priority 2) or Super Admins (priority 1).
 */
async function enforceHierarchy(requesterUid, targetUid, res) {
    if (!requesterUid) {
        res.status(401).json({ error: 'Unauthorized: Requester identification is missing' });
        return false;
    }
    if (!targetUid) {
        res.status(400).json({ error: 'Target user identification is missing' });
        return false;
    }

    const requesterPriority = await getUserPriority(requesterUid);
    const targetPriority = await getUserPriority(targetUid);

    console.log(`[Hierarchy Check] Requester ${requesterUid} (Priority ${requesterPriority}) -> Target ${targetUid} (Priority ${targetPriority})`);

    // Only priority 1 (Super Admin) can modify priority 1 or 2.
    if (targetPriority <= 2 && requesterPriority > 1) {
        res.status(403).json({ error: `Forbidden: You do not have authority to modify this account (Requester priority: ${requesterPriority}, Target priority: ${targetPriority})` });
        return false;
    }

    // For all other cases, requester priority must be strictly less than target priority (higher privilege)
    if (requesterPriority >= targetPriority) {
        res.status(403).json({ error: `Forbidden: You do not have authority to modify this account (Requester priority: ${requesterPriority}, Target priority: ${targetPriority})` });
        return false;
    }

    return true;
}

async function fetchRolesByIdsOrNames(roleIds) {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];

    // Only query by strict UUID
    const { data: rolesData, error: rolesError } = await supabase
        .from('system_roles')
        .select('id, name, priority')
        .in('id', roleIds);

    if (rolesError) throw rolesError;
    return rolesData || [];
}

function isSuperAdminRoleRecord(role) {
    if (role?.priority !== undefined && role.priority <= 1) return true;
    return false;
}

// Create User in Supabase Auth
router.post('/create-user', requirePermission('MANAGE_USERS'), async (req, res) => {
    try {
        const { employeeId, roleIds, adminId } = req.body;
        
        if (!employeeId || !roleIds || roleIds.length === 0) {
            return res.status(400).json({ error: 'Missing employeeId or roleIds' });
        }

        // 1. Enforce permission
        const allowed = await hasPermission(adminId, 'MANAGE_USERS');
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden: Missing MANAGE_USERS permission' });
        }

        // 1a. Enforce hierarchy checks for creation
        const adminPriority = await getUserPriority(adminId);

        // 1b. Enforce: Only Super Admin can create another Super Admin
        const requestedRoleRecords = await fetchRolesByIdsOrNames(roleIds);
        const creatingSuperAdmin = requestedRoleRecords.some(isSuperAdminRoleRecord);
        if (creatingSuperAdmin && adminPriority !== 1) {
            return res.status(403).json({ error: 'Forbidden: Only Super Admin can create another Super Admin' });
        }

        // 2. Fetch the target employee from employees table
        const { data: employee, error: empErr } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employeeId)
            .maybeSingle();

        if (empErr) throw empErr;
        if (!employee) {
            return res.status(404).json({ error: `Employee not found with ID ${employeeId}` });
        }

        if (!employee.email) {
            return res.status(400).json({ error: 'Employee email is missing. Please update the employee record first.' });
        }

        // 3. Normalize mobile number for temporary password (never log or return)
        const password = temporaryPasswordFromPhone(employee.phone_number);
        if (!password) {
            return res.status(400).json({ error: MOBILE_REQUIRED_ERROR });
        }

        // 4. Create User in Supabase Auth via Admin API
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: employee.email,
            password: password,
            email_confirm: true,
            user_metadata: { 
                full_name: employee.full_name || employee.name,
                displayName: employee.full_name || employee.name
            }
        });

        if (authError) throw authError;

        const uid = authData.user.id;

        // 5. Insert profile into user_profiles
        const { error: profileErr } = await supabase
            .from('user_profiles')
            .insert([{
                uid: uid,
                id: uid,
                display_name: employee.full_name || employee.name,
                full_name: employee.full_name || employee.name,
                email: employee.email,
                employee_id: employeeId,
                role_ids: roleIds,
                is_enabled: true,
                is_deleted: false,
                must_change_password: true,
                last_password_reset: new Date().toISOString(),
                created_by: adminId,
                updated_at: new Date().toISOString()
            }]);

        if (profileErr) {
            // Cleanup auth user if profile creation fails to prevent orphan auth records
            await supabase.auth.admin.deleteUser(uid);
            throw profileErr;
        }

        // 6. Log to audit logs
        const adminName = await getPerformedByName(adminId);

        await supabase.from('audit_logs').insert([{
            action: 'CREATE',
            entity_type: 'USER',
            entity_id: uid,
            performed_by: adminId,
            details: {
                performed_by_name: adminName,
                employeeId,
                roleIds,
                message: 'Created system user linked to employee record'
            }
        }]);

        res.json({
            success: true,
            message: 'User created successfully. User must change password on first login.'
        });

    } catch (error) {
        console.error('Supabase Create User Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Reset Password to Employee Phone
router.post('/reset-password', requirePermission('MANAGE_USERS'), async (req, res) => {
    try {
        const { userId, adminId } = req.body;
        if (!userId || !adminId) {
            return res.status(400).json({ error: 'Missing userId or adminId' });
        }

        // 0. Enforce permission
        const allowed = await hasPermission(adminId, 'MANAGE_USERS');
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden: Missing MANAGE_USERS permission' });
        }

        // 1. Enforce hierarchy check
        const isAuthorized = await enforceHierarchy(adminId, userId, res);
        if (!isAuthorized) return;

        // 2. Fetch user profile to get employee link
        const { data: profile, error: profileErr } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('uid', userId)
            .maybeSingle();

        if (profileErr) throw profileErr;
        if (!profile) return res.status(404).json({ error: 'User profile not found' });
        if (!profile.employee_id) {
            return res.status(400).json({ error: 'User is not linked to any employee record. Cannot reset password.' });
        }

        // 3. Fetch employee to get phone number
        const { data: employee, error: empErr } = await supabase
            .from('employees')
            .select('phone_number')
            .eq('id', profile.employee_id)
            .maybeSingle();

        if (empErr || !employee) {
            return res.status(400).json({ error: 'Employee record not found. Cannot reset password.' });
        }

        // 4. Normalize mobile number for temporary password (never log or return)
        const newPassword = temporaryPasswordFromPhone(employee.phone_number);
        if (!newPassword) {
            return res.status(400).json({ error: MOBILE_REQUIRED_ERROR });
        }

        // 5. Reset password directly via admin API
        const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
            password: newPassword
        });

        if (authError) throw authError;

        // 6. Update user_profiles
        const { error: updateProfileErr } = await supabase
            .from('user_profiles')
            .update({
                must_change_password: true,
                last_password_reset: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('uid', userId);

        if (updateProfileErr) throw updateProfileErr;

        // 7. Audit log
        const adminName = await getPerformedByName(adminId);
        await supabase.from('audit_logs').insert([{
            action: 'RESET_PASSWORD',
            entity_type: 'USER',
            entity_id: userId,
            performed_by: adminId,
            details: {
                performed_by_name: adminName,
                message: 'Credentials reset by administrator',
                target_email: profile.email
            }
        }]);

        res.json({ message: 'Password reset successfully. User must change password on next login.' });

    } catch (error) {
        console.error('Supabase Reset Password Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Toggle User Status
router.post('/toggle-user-status', requirePermission('MANAGE_USERS'), async (req, res) => {
    try {
        const { uid, isEnabled, adminId } = req.body;
        if (!uid || typeof isEnabled !== 'boolean' || !adminId) {
            return res.status(400).json({ error: 'Missing parameters: uid, isEnabled, or adminId' });
        }

        // 0. Enforce permission
        const allowed = await hasPermission(adminId, 'MANAGE_USERS');
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden: Missing MANAGE_USERS permission' });
        }

        // 1. Enforce hierarchy check
        const isAuthorized = await enforceHierarchy(adminId, uid, res);
        if (!isAuthorized) return;

        // 2. Set is_enabled in user_profiles
        const { error: profileErr } = await supabase
            .from('user_profiles')
            .update({
                is_enabled: isEnabled,
                updated_at: new Date().toISOString()
            })
            .eq('uid', uid);

        if (profileErr) throw profileErr;

        // 3. Toggle employee active status as well for synchronization
        const { data: profile } = await supabase.from('user_profiles').select('employee_id').eq('uid', uid).maybeSingle();
        if (profile && profile.employee_id) {
            await supabase
                .from('employees')
                .update({ is_active: isEnabled })
                .eq('id', profile.employee_id);
        }

        // 4. Log to audit logs
        const adminName = await getPerformedByName(adminId);

        await supabase.from('audit_logs').insert([{
            action: isEnabled ? 'ACTIVATE' : 'DEACTIVATE',
            entity_type: 'USER',
            entity_id: uid,
            performed_by: adminId,
            details: {
                performed_by_name: adminName,
                isEnabled,
                message: `Toggled user status to ${isEnabled ? 'Active' : 'Inactive'}`
            }
        }]);

        res.json({ success: true, message: `User status updated to ${isEnabled ? 'Active' : 'Inactive'}` });
    } catch (error) {
        console.error('Toggle User Status Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete User
router.post('/delete-user', requirePermission('MANAGE_USERS'), async (req, res) => {
    try {
        const { userId, adminId, adminName } = req.body;
        if (!userId || !adminId) {
            return res.status(400).json({ error: 'Missing userId or adminId' });
        }

        // 0. User cannot delete themselves
        if (userId === adminId) {
            return res.status(403).json({ error: 'Forbidden: You cannot delete your own account' });
        }

        // 0.5 Enforce permission
        const allowed = await hasPermission(adminId, 'MANAGE_USERS');
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden: Missing MANAGE_USERS permission' });
        }

        // 1. Enforce hierarchy check
        const isAuthorized = await enforceHierarchy(adminId, userId, res);
        if (!isAuthorized) return;

        // 2. Mark deleted in user_profiles
        const { error: profileErr } = await supabase
            .from('user_profiles')
            .update({
                is_deleted: true,
                is_enabled: false,
                status: 'DELETED',
                deleted_at: new Date().toISOString(),
                deleted_by: adminId,
                updated_at: new Date().toISOString(),
                updated_by: adminId
            })
            .eq('uid', userId);

        if (profileErr) throw profileErr;

        // 3. Mark inactive in employees table too
        const { data: profile } = await supabase.from('user_profiles').select('employee_id').eq('uid', userId).maybeSingle();
        if (profile && profile.employee_id) {
            await supabase
                .from('employees')
                .update({ is_active: false })
                .eq('id', profile.employee_id);
        }

        // 4. Log to audit logs
        const performedByName = adminName || (await getPerformedByName(adminId));

        await supabase.from('audit_logs').insert([{
            action: 'DELETE',
            entity_type: 'USER',
            entity_id: userId,
            performed_by: adminId,
            details: {
                performed_by_name: performedByName,
                message: 'Deleted user account (marked as deleted)'
            }
        }]);

        res.json({ success: true, message: 'User account marked as deleted' });
    } catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Reactivate User
router.post('/reactivate-user', requirePermission('MANAGE_USERS'), async (req, res) => {
    try {
        const { userId, roleIds, adminId } = req.body;
        if (!userId || !roleIds || roleIds.length === 0 || !adminId) {
            return res.status(400).json({ error: 'Missing parameters: userId, roleIds, or adminId' });
        }

        // 1. Enforce permission
        const allowed = await hasPermission(adminId, 'MANAGE_USERS');
        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden: Missing MANAGE_USERS permission' });
        }
        const adminPriority = await getUserPriority(adminId);

        // 2. Fetch target user priority (before changes)
        const targetPriority = await getUserPriority(userId);
        
        // Only priority 1 (Super Admin) can modify priority 1 or 2
        if (targetPriority <= 2 && adminPriority > 1) {
            return res.status(403).json({ error: 'Forbidden: You do not have authority to reactivate this account' });
        }

        // 3. Reactivate user in user_profiles
        const { error: profileErr } = await supabase
            .from('user_profiles')
            .update({
                is_deleted: false,
                is_enabled: true,
                status: 'ACTIVE',
                deleted_at: null,
                deleted_by: null,
                role_ids: roleIds,
                updated_at: new Date().toISOString(),
                updated_by: adminId
            })
            .eq('uid', userId);

        if (profileErr) throw profileErr;

        // 4. Reactivate employee in employees
        const { data: profile } = await supabase.from('user_profiles').select('employee_id').eq('uid', userId).maybeSingle();
        if (profile && profile.employee_id) {
            await supabase
                .from('employees')
                .update({ is_active: true, is_resigned: false })
                .eq('id', profile.employee_id);
        }

        // 5. Log to audit logs
        const adminName = await getPerformedByName(adminId);

        await supabase.from('audit_logs').insert([{
            action: 'REACTIVATE',
            entity_type: 'USER',
            entity_id: userId,
            performed_by: adminId,
            details: {
                performed_by_name: adminName,
                roleIds,
                message: 'Reactivated user account'
            }
        }]);

        res.json({ success: true, message: 'User account reactivated successfully' });
    } catch (error) {
        console.error('Reactivate User Error:', error);
        res.status(500).json({ error: error.message });
    }
});


// Get Database Schema Mapping (Professional Metadata Retrieval)
router.get('/schema', async (req, res) => {
    try {
        console.log("GET /api/admin/schema hit");
        const { data, error } = await supabase.rpc('get_schema_registry');
        
        if (error) {
            console.error("Supabase RPC Schema Error:", error);
            return res.status(500).json({ success: false, error: error.message });
        }
        
        res.json({ success: true, data: data || {} });
    } catch (err) {
        console.error("Fetch Schema Catch Block:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch Comprehensive Audit Logs
router.get('/audit-logs', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
        const offset = (page - 1) * limit;
        const { action, search, startDate, endDate, entityType } = req.query;

        let query = supabase
            .from('audit_logs')
            .select('*', { count: 'exact' })
            .order('performed_at', { ascending: false, nullsFirst: false });

        if (action && action !== 'ALL') {
            query = query.ilike('action', `%${action}%`);
        }
        if (entityType && entityType !== 'ALL') {
            query = query.ilike('entity_type', `%${entityType}%`);
        }
        if (startDate) {
            query = query.gte('performed_at', startDate);
        }
        if (endDate) {
            query = query.lte('performed_at', endDate);
        }

        query = query.range(offset, offset + limit - 1);

        const { data, count, error } = await query;
        if (error) throw error;

        // Fetch user profiles and employee records for performed_by and targets
        const uids = new Set();
        (data || []).forEach(log => {
            if (log.performed_by) uids.add(log.performed_by);
            if (log.entity_type === 'USER' && log.entity_id) uids.add(log.entity_id);
        });

        let userMap = {};
        if (uids.size > 0) {
            try {
                const { data: profiles } = await supabase
                    .from('user_profiles')
                    .select('uid, full_name, display_name, email, employee_id, is_owner_super_admin')
                    .in('uid', Array.from(uids));

                const empIds = new Set();
                (profiles || []).forEach(p => {
                    if (p.employee_id) empIds.add(p.employee_id);
                });

                let empMap = {};
                if (empIds.size > 0) {
                    const { data: emps } = await supabase
                        .from('employees')
                        .select('id, full_name, email, employee_id_hash')
                        .in('id', Array.from(empIds));
                    (emps || []).forEach(e => {
                        empMap[e.id] = e;
                    });
                }

                (profiles || []).forEach(p => {
                    const linkedEmp = p.employee_id ? empMap[p.employee_id] : null;
                    const name = p.display_name || p.full_name || linkedEmp?.full_name || (p.email ? p.email.split('@')[0] : 'Admin');
                    
                    // Prioritize actual employee ID hash / code, then employee_id, then fallback
                    let empCode = linkedEmp?.employee_id_hash || (p.employee_id ? `EMP-${String(p.employee_id).slice(0, 6).toUpperCase()}` : null);
                    if (!empCode) {
                        empCode = p.is_owner_super_admin ? 'SUPER-ADMIN' : `ADM-${p.uid.slice(0, 6).toUpperCase()}`;
                    }

                    userMap[p.uid] = {
                        name,
                        employee_id: empCode,
                        email: p.email,
                        is_admin: Boolean(p.is_owner_super_admin)
                    };
                });
            } catch (pErr) {
                console.warn('[AuditLogs] User profiles resolution warning:', pErr);
            }
        }

        const formattedLogs = (data || []).map(log => {
            let detailsObj = log.details;
            if (typeof detailsObj === 'string') {
                try { detailsObj = JSON.parse(detailsObj); } catch(e) {}
            }

            const userInfo = userMap[log.performed_by];
            const actorName = log.performed_by_name || detailsObj?.performed_by_name || userInfo?.name || 'System';
            const actorEmpId = detailsObj?.employee_id || detailsObj?.employee_code || userInfo?.employee_id || (log.performed_by ? `EMP-${log.performed_by.slice(0, 6).toUpperCase()}` : 'SYSTEM');

            const targetUserInfo = userMap[log.entity_id];
            const targetName = detailsObj?.target_name || detailsObj?.name || detailsObj?.title || targetUserInfo?.name || log.entity_id || 'System';
            const targetEmpId = targetUserInfo?.employee_id || null;

            return {
                id: log.id,
                action: log.action || 'ACTIVITY',
                entity_type: log.entity_type || 'SYSTEM',
                entity_id: log.entity_id,
                performed_by: log.performed_by,
                actor_name: actorName,
                employee_id: actorEmpId,
                target_name: targetName,
                target_employee_id: targetEmpId,
                details: detailsObj,
                performed_at: log.performed_at || log.created_at || new Date().toISOString()
            };
        });

        res.json({
            success: true,
            data: formattedLogs,
            pagination: {
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (err) {
        console.error('Audit logs fetch error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
