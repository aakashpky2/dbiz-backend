const dotenv = require("dotenv");
dotenv.config({ path: "../.env" });
const { supabase } = require("../lib/supabase");

async function run() {
    try {
        console.log("Starting Phase 1: Clean Database / Role Data");

        // 1. Fetch existing system_roles
        const { data: roles, error: rolesError } = await supabase.from('system_roles').select('*');
        if (rolesError) throw rolesError;

        console.log(`Found ${roles.length} roles.`);

        // 2. Fetch user_profiles
        const { data: profiles, error: profilesError } = await supabase.from('user_profiles').select('*');
        if (profilesError) throw profilesError;

        console.log(`Found ${profiles.length} profiles.`);

        // Clean user_profiles.role_ids: remove old/invalid ids, only keep valid system_roles.id
        const validRoleIds = new Set(roles.map(r => r.id));
        const superAdminRoleId = "cbebb46a-d78d-4367-8eaf-40e34c341a1b";

        for (const profile of profiles) {
            let roleIds = profile.role_ids;
            let updated = false;
            let isOwnerSuperAdmin = profile.is_owner_super_admin;

            if (typeof roleIds === 'string') {
                try {
                    roleIds = JSON.parse(roleIds);
                } catch(e) {
                    roleIds = [];
                }
                updated = true;
            }

            if (!Array.isArray(roleIds)) {
                roleIds = [];
                updated = true;
            }

            // Target specific users
            if (profile.email === 'aakashpky@gmail.com') {
                roleIds = [superAdminRoleId];
                isOwnerSuperAdmin = true;
                updated = true;
            } else if (profile.email === 'admin@dbiz.com') {
                roleIds = [superAdminRoleId];
                isOwnerSuperAdmin = false;
                updated = true;
            } else {
                // Filter invalid ones
                const originalLength = roleIds.length;
                roleIds = roleIds.filter(id => validRoleIds.has(id));
                // If they had old 'SUPER_ADMIN' string or 'Super Admin' string, replace with real ID
                if (profile.role_ids && (profile.role_ids.includes('SUPER_ADMIN') || profile.role_ids.includes('Super Admin'))) {
                    if (!roleIds.includes(superAdminRoleId)) {
                        roleIds.push(superAdminRoleId);
                    }
                }
                if (roleIds.length !== originalLength) {
                    updated = true;
                }
            }

            if (updated) {
                console.log(`Updating profile ${profile.email}...`);
                const { error } = await supabase.from('user_profiles').update({
                    role_ids: roleIds,
                    is_owner_super_admin: isOwnerSuperAdmin
                }).eq('uid', profile.uid);
                if (error) throw error;
            }
        }

        console.log("Phase 1 complete.");

        console.log("Starting Phase 3: SQL Seed Default Role Permissions");
        const permissionsSeed = {
            'Super Admin': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "VIEW_ALL_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS", "PAUSE_TASKS", "VIEW_WORK", "MANAGE_WORK", "ASSIGN_WORK", "VIEW_CLIENTS", "MANAGE_CLIENTS", "VIEW_PROPOSALS", "MANAGE_PROPOSALS", "VIEW_WORKFLOWS", "MANAGE_WORKFLOWS", "MANAGE_WORK_BASED_FLOW", "MANAGE_CLIENT_BASED_FLOW", "VIEW_EMPLOYEE_DIRECTORY", "MANAGE_EMPLOYEES", "VIEW_TEAMS", "MANAGE_TEAMS", "VIEW_ALL_ATTENDANCE", "MANAGE_LEAVES", "MANAGE_PROMOTIONS", "VIEW_ADMIN_PANEL", "MANAGE_USERS", "MANAGE_SYSTEM_ROLES", "MANAGE_PERMISSIONS", "MANAGE_DEPARTMENTS", "MANAGE_SETTINGS", "VIEW_REPORTS", "EXPORT_REPORTS", "OWNER_SUPER_ADMIN_CONTROLS"],
            'ADMIN': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "VIEW_ALL_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS", "VIEW_WORK", "MANAGE_WORK", "ASSIGN_WORK", "VIEW_CLIENTS", "MANAGE_CLIENTS", "VIEW_PROPOSALS", "MANAGE_PROPOSALS", "VIEW_WORKFLOWS", "MANAGE_WORKFLOWS", "MANAGE_WORK_BASED_FLOW", "MANAGE_CLIENT_BASED_FLOW", "VIEW_EMPLOYEE_DIRECTORY", "MANAGE_EMPLOYEES", "VIEW_TEAMS", "MANAGE_TEAMS", "VIEW_ALL_ATTENDANCE", "MANAGE_LEAVES", "MANAGE_PROMOTIONS", "VIEW_ADMIN_PANEL", "MANAGE_USERS", "MANAGE_SYSTEM_ROLES", "MANAGE_PERMISSIONS", "MANAGE_DEPARTMENTS", "MANAGE_SETTINGS", "VIEW_REPORTS", "EXPORT_REPORTS"],
            'HR MANAGER': ["VIEW_DASHBOARD", "VIEW_EMPLOYEE_DIRECTORY", "MANAGE_EMPLOYEES", "VIEW_TEAMS", "MANAGE_TEAMS", "VIEW_ALL_ATTENDANCE", "MANAGE_LEAVES", "MANAGE_PROMOTIONS", "VIEW_REPORTS"],
            'MANAGER': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "VIEW_ALL_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS", "VIEW_WORK", "ASSIGN_WORK", "VIEW_CLIENTS", "VIEW_WORKFLOWS", "VIEW_EMPLOYEE_DIRECTORY", "VIEW_TEAMS", "MANAGE_TEAMS", "VIEW_REPORTS"],
            'ACCOUNTANT': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS", "VIEW_WORK", "VIEW_CLIENTS", "VIEW_PROPOSALS"],
            'STAFF': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS", "VIEW_WORK"],
            'Employee': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS", "CLAIM_TASKS", "COMPLETE_TASKS"],
            'INTERN': ["VIEW_DASHBOARD", "VIEW_TASKS", "VIEW_MY_TASKS"]
        };

        for (const roleName of Object.keys(permissionsSeed)) {
            const role = roles.find(r => r.name === roleName);
            if (role) {
                console.log(`Updating permissions for ${roleName}...`);
                let perms = permissionsSeed[roleName];
                const { error } = await supabase.from('system_roles').update({
                    permissions: perms
                }).eq('id', role.id);
                if (error) throw error;
            } else {
                console.warn(`Role ${roleName} not found in DB!`);
            }
        }

        console.log("Phase 3 complete.");

    } catch (e) {
        console.error("Script failed:", e);
    }
}
run();
