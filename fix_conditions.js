require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixConditions() {
    const sql = `
        ALTER TABLE government_fee_applicability_conditions
        ADD COLUMN IF NOT EXISTS mapping_id uuid REFERENCES government_fee_source_mappings(id);
        
        NOTIFY pgrst, 'reload schema';
    `;
    
    console.log("Running SQL...");
    const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });
    
    if (error) {
        console.error("RPC failed:", error.message);
        console.log("Will try alternative approach if necessary.");
    } else {
        console.log("Success:", data);
    }
}

fixConditions();
