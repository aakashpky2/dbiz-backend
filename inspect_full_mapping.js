const { supabase } = require('./lib/supabase');

async function checkMapping() {
    try {
        console.log("=== EMPLOYEES ===");
        const { data: emps } = await supabase.from('employees').select('id, full_name, email, employee_role');
        console.log("Employees:", emps);

        console.log("\n=== USER PROFILES ===");
        const { data: profiles } = await supabase.from('user_profiles').select('*');
        console.log("User Profiles:", profiles);

        console.log("\n=== SYSTEM ROLES ===");
        const { data: roles } = await supabase.from('system_roles').select('*');
        console.log("System Roles:", roles);
    } catch (e) {
        console.error(e);
    }
}

checkMapping();
