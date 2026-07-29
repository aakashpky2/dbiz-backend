require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
        console.error("No database URL found in .env");
        process.exit(1);
    }
    const client = new Client({ connectionString: dbUrl });
    try {
        await client.connect();
        const sql = fs.readFileSync('migrations/20260709_add_billing_trigger.sql', 'utf8');
        await client.query(sql);
        console.log("Migration executed successfully!");
    } catch (e) {
        console.error("Migration failed:", e.message);
    } finally {
        await client.end();
    }
}
run();
