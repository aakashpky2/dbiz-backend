require('dotenv').config({ path: '../frontend/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', '20260601_fix_constitutions.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Running migration...");
    const { error } = await supabase.rpc('run_sql', { sql_query: sql });
    
    if (error) {
        console.error("Migration error:", error.message);
    } else {
        console.log("Migration successful!");
    }
}

run();
