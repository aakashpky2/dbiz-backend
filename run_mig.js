require('dotenv').config({path: '../frontend/.env.local'});
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const sql = fs.readFileSync('c:\\acoundz\\d-biz-app-new\\backend\\migrations\\20260716_work_v2_complete_rpc.sql', 'utf8');
  const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });
  if (error) {
    console.error("Migration failed:", error);
  } else {
    console.log("Migration succeeded.");
  }
}
run();
