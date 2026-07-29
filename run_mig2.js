const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: 'postgresql://postgres.oyylyrhtxsthtfyyqrmv:oK49X8bI3qQeN5uJ@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
});

async function run() {
  const sql = fs.readFileSync('migrations/20260715_create_works_transaction_rpc.sql', 'utf8');
  try {
    await pool.query(sql);
    console.log("Migration succeeded.");
  } catch (e) {
    console.error("Migration failed:", e);
  } finally {
    pool.end();
  }
}
run();
