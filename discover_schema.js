require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function checkSchema(tableName) {
  const { data, error } = await supabase.from(tableName).select('*').limit(1);
  if (error) {
    console.log(`Table ${tableName} error:`, error.message);
  } else if (data && data.length > 0) {
    console.log(`Table ${tableName} columns:`, Object.keys(data[0]));
  } else {
    console.log(`Table ${tableName} has 0 rows or exists.`);
  }
}

async function run() {
  await checkSchema('employees');
  await checkSchema('user_profiles');
  await checkSchema('users');
  await checkSchema('system_users');
  await checkSchema('business_profiles');
  await checkSchema('departments');
  await checkSchema('system_roles');
  await checkSchema('user_roles');
  
  await checkSchema('employee_departments');
  await checkSchema('employee_profiles');
}

run();
