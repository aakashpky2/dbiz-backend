const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres.oyylyrhtxsthtfyyqrmv:oK49X8bI3qQeN5uJ@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Running ALTER TABLE...');
    await client.query(`
      ALTER TABLE proposals
      ADD COLUMN IF NOT EXISTS template_id uuid NULL,
      ADD COLUMN IF NOT EXISTS template_configuration_id uuid NULL,
      ADD COLUMN IF NOT EXISTS template_snapshot jsonb NULL;
    `);
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    client.release();
    pool.end();
  }
}

main();
