require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await pool.query(`ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;`);
        console.log("Migration successful: Added is_billable to workflow_templates.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await pool.end();
    }
}
run();
