require('dotenv').config({path: '../frontend/.env.local'});
const { Pool } = require('pg');
const fs = require('fs');

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    const sql = fs.readFileSync('c:\\acoundz\\d-biz-app-new\\backend\\migrations\\20260716_work_v2_complete_rpc.sql', 'utf8');
    await pool.query(sql);
    console.log("Migration succeeded.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}
run();
