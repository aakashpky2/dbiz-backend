require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.rpc('execute_sql_query', { query_text: "SELECT routine_name, routine_definition FROM information_schema.routines WHERE routine_name IN ('log_work_creation', 'log_work_update');" });
  if (error) {
    const { data: d2 } = await supabase.rpc('run_sql', { sql_query: "SELECT routine_name, routine_definition FROM information_schema.routines WHERE routine_name IN ('log_work_creation', 'log_work_update');" });
    console.log(d2);
  } else {
    console.log(data);
  }
}
run();
