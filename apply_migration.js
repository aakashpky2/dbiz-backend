require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', '20260610_independent_gov_fee_library.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split sql into statements safely by detecting ';', or just pass the whole string if RPC accepts it.
    // Usually the postgres API can execute multiple statements.
    
    console.log("Applying Migration...");
    const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });
    if (error) {
        console.error("Error applying migration:", error);
    } else {
        console.log("Migration applied successfully!");
    }
}

run();
