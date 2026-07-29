require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.rpc('execute_sql_query', { query_text: `
    SELECT t.tgname, t.tgenabled, p.proname, p.prosrc 
    FROM pg_trigger t 
    JOIN pg_proc p ON t.tgfoid = p.oid 
    WHERE t.tgname IN ('log_work_creation', 'log_work_update');
  `});
  console.log(JSON.stringify(data, null, 2));
}
run();
