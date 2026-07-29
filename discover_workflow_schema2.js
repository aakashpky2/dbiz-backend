require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function checkSchema(tableName) {
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_name', tableName)
    .order('ordinal_position');
    
  if (error) {
    console.log(`Table ${tableName} error:`, error.message);
  } else if (data && data.length > 0) {
    console.log(`Table ${tableName} columns:`, data.map(d => d.column_name));
  } else {
    // try public schema specifically if needed, but information_schema usually needs rpc or direct query.
    // Wait, querying information_schema might be restricted via REST API.
    // Let's try to do a postgres query via an RPC if we can, or just insert a dummy row, rollback.
  }
}

async function checkSchemaFallback(tableName) {
    // If information_schema is restricted
    const { data, error } = await supabase.rpc('get_columns', { p_table_name: tableName });
    if(error) {
         console.log(error);
    } else {
        console.log(data);
    }
}

run();
