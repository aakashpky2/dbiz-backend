require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase.rpc('execute_sql_query', { query_text: `
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'work_assignment_history'
    ORDER BY ordinal_position;
  `});
  console.log("work_assignment_history:", data);

  const { data: data2 } = await supabase.rpc('execute_sql_query', { query_text: `
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'work_member_assignments'
    ORDER BY ordinal_position;
  `});
  console.log("work_member_assignments:", data2);
}
run();
