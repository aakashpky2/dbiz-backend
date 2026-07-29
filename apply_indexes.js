require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sql = fs.readFileSync(__dirname + '/migrations/20260612_performance_indexes.sql', 'utf8');
  
  // Try to use rpc to execute sql or just leave it for the user to apply manually via Supabase dashboard
  console.log("Indexes migration script created. Please apply it via Supabase Dashboard SQL editor:");
  console.log(sql);
}

run();
