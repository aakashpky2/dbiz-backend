require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql = fs.readFileSync('migrations/20260715_create_works_transaction_rpc.sql', 'utf8');

async function run() {
  const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });
  if (error) {
    const { data: d2, error: e2 } = await supabase.rpc('execute_sql_query', { query_text: sql });
    console.log("fallback:", e2 || d2);
  } else {
    console.log("success:", data);
  }
}
run();
