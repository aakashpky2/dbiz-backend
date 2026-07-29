require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', '001_create_user_active_work.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Applying Migration...");
    // Some implementations use run_sql, others execute_sql
    let { data, error } = await supabase.rpc('execute_sql', { query_text: sql });
    
    if (error && error.message.includes('Could not find the function')) {
        console.log("execute_sql not found, trying run_sql");
        const res = await supabase.rpc('run_sql', { sql_query: sql });
        error = res.error;
        data = res.data;
    }

    if (error) {
        console.error("Error applying migration:", error);
    } else {
        console.log("Migration applied successfully!");
    }
}

run();
