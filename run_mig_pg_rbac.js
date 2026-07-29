require('dotenv').config({path: '../frontend/.env.local'});
const { Pool } = require('pg');
const fs = require('fs');

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    const sql = fs.readFileSync('c:\\acoundz\\d-biz-app-new\\backend\\migrations\\20260717_rbac_v2.sql', 'utf8');
    await pool.query(sql);
    console.log("Migration 20260717_rbac_v2 succeeded.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}
run();
