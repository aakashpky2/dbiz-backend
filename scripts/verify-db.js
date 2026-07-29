require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyDatabase() {
    console.log('Verifying database changes...');

    // 1. Check if is_owner_super_admin exists
    console.log('Checking for is_owner_super_admin column in user_profiles...');
    const { data: userProfiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('uid, is_owner_super_admin')
        .limit(1);

    if (profilesError) {
        console.error('Error fetching user_profiles (column might be missing):', profilesError.message);
    } else {
        console.log('Success! is_owner_super_admin column exists.');
    }

    // 2. Check system_roles for permissions
    console.log('\nChecking system_roles for populated permissions...');
    const { data: roles, error: rolesError } = await supabase
        .from('system_roles')
        .select('name, permissions');
        
    if (rolesError) {
        console.error('Error fetching system_roles:', rolesError.message);
    } else {
        let hasPermissions = false;
        roles.forEach(role => {
            if (role.permissions && role.permissions.length > 0) {
                console.log(`- Role '${role.name}' has ${role.permissions.length} permissions.`);
                hasPermissions = true;
            } else {
                console.log(`- Role '${role.name}' has no permissions.`);
            }
        });
        
        if (!hasPermissions) {
            console.log('\nWARNING: No roles have permissions populated. Did you run the run-phase1-3.js script?');
        } else {
            console.log('\nSuccess! Roles have permissions populated.');
        }
    }
}

verifyDatabase();
