// run-p1.js
// Runs Phase 1 SQL migration with correct environment variables path config.

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the correct local env file
const envPath = path.join(__dirname, '..', '..', 'frontend', '.env.local');
dotenv.config({ path: envPath });

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Environment variables missing from:", envPath);
    console.log("NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "Found" : "Missing");
    console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "Found" : "Missing");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runPhase1() {
    const migrationPath = path.join(__dirname, '..', 'migrations', '20260519_create_workflow_execution_instances.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`Executing Phase 1 migration from ${migrationPath}...`);

    try {
        const { error } = await supabase.rpc('execute_sql', { sql_query: sql });

        if (error) {
            console.error('Error executing via execute_sql, attempting run_sql...', error);
            const { error: error2 } = await supabase.rpc('run_sql', { sql_query: sql });
            if (error2) {
                console.error('Migration failed with both run_sql and execute_sql. Details:', error2);
                process.exit(1);
            }
        }

        console.log('Phase 1 Migration Applied Successfully!');
    } catch (err) {
        console.error('Exception thrown during migration:', err.message);
        process.exit(1);
    }
}

runPhase1();
