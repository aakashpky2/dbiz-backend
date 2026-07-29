const { supabase } = require('./lib/supabase');
const fs = require('fs');

async function run() {
    try {
        const sql = fs.readFileSync('migrations/20260717_rbac_v2.sql', 'utf8');
        console.log("Applying migration...");
        
        let { data, error } = await supabase.rpc('exec_sql', { query_text: sql });
        
        if (error && error.message && error.message.includes('Could not find')) {
            console.log("exec_sql not found, trying execute_sql_query...");
            const res = await supabase.rpc('execute_sql_query', { query_text: sql });
            data = res.data;
            error = res.error;
        }

        if (error) {
            console.error("Migration failed:", error);
            process.exit(1);
        } else {
            console.log("Migration succeeded:", data);
        }
    } catch (e) {
        console.error("Script failed:", e);
    }
}
run();
