require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
  const tables = ['user_profiles', 'system_roles', 'audit_logs', 'employees', 'departments'];
  for (const table of tables) {
    const { data: rowData, error } = await supabase.from(table).select('*').limit(1);
    console.log(`\n--- TABLE: ${table} ---`);
    if (error) {
      console.log('Error fetching:', error.message);
    } else if (rowData && rowData.length > 0) {
      console.log(Object.keys(rowData[0]).join(', '));
      console.log("Types sample:");
      const types = {};
      Object.keys(rowData[0]).forEach(k => {
        types[k] = typeof rowData[0][k] + (rowData[0][k] === null ? ' (null)' : '');
      });
      console.log(types);
    } else {
      console.log('Table exists but is empty.');
    }
  }
}
inspectSchema();
