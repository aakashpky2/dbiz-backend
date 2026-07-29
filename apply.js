require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const sql = fs.readFileSync('migrations/20260716_work_v2_claim_rpc.sql', 'utf8');
  await pool.query(sql);
  console.log('Migration applied.');
  pool.end();
}
run();
