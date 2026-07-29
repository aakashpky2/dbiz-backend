require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.rpc('execute_sql_query', { query_text: `
    SELECT pg_get_functiondef(oid) 
    FROM pg_proc 
    WHERE proname IN ('log_work_creation_func', 'log_work_update_func');
  `});
  console.log(data);
}
run();
