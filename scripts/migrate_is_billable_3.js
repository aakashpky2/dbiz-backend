require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    try {
        const { error } = await supabase.rpc('run_sql', { 
            sql_query: `ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;` 
        });
        
        if (error) {
            console.error("Migration error:", error.message);
        } else {
            console.log("Migration successful: Added is_billable to workflow_templates.");
        }
    } catch (e) {
        console.error("Migration failed:", e);
    }
}
run();
