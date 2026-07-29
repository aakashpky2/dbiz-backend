const { supabase } = require('./lib/supabase');
const { calculateEmployeeCompletion } = require('./lib/completion-helper');

async function fixAllCompletion() {
    console.log("Starting full completion audit for all employees...");
    
    const { data: employees, error } = await supabase
        .from('employees')
        .select(`
            *,
            employee_addresses(*),
            employee_emergency_contacts(*),
            employee_bank_details(*),
            employee_qualifications(*),
            employee_medical_info(*),
            employee_employment_details(*)
        `);

    if (error) {
        console.error("Error fetching employees:", error);
        return;
    }

    console.log(`Auditing ${employees.length} employees...`);

    for (const emp of employees) {
        const score = calculateEmployeeCompletion(emp);
        console.log(`Employee: ${emp.full_name} (${emp.employee_id_hash}) -> ${score}%`);
        
        const { error: updateError } = await supabase
            .from('employees')
            .update({ completion_percentage: score })
            .eq('id', emp.id);
            
        if (updateError) {
            console.error(`  Error updating ${emp.full_name}:`, updateError);
        }
    }

    console.log("Audit complete.");
}

fixAllCompletion();
