const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("No Supabase URL/Key found");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('employees').select('*').limit(1);
  if (error) {
    console.error(error);
  } else {
    console.log("EMPLOYEES COLUMNS:");
    if (data.length > 0) {
      console.log(Object.keys(data[0]).join(', '));
    } else {
      console.log("No rows in employees");
    }
  }
}
run();
