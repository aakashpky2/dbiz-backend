const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/.env' });

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("Missing DATABASE_URL in backend/.env");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();

    console.log("Checking tables...");
    const resTables = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'responsibility_templates',
          'responsibility_template_permissions',
          'user_responsibilities',
          'role_responsibilities',
          'user_permission_overrides',
          'user_responsibility_scopes',
          'permission_audit_logs'
        )
      order by table_name;
    `);
    console.table(resTables.rows);

    console.log("Checking foreign keys...");
    const resFk = await client.query(`
      select
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name as referenced_table,
        ccu.column_name as referenced_column
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.constraint_schema = kcu.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.constraint_schema = tc.constraint_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name in (
          'responsibility_template_permissions',
          'user_responsibilities',
          'role_responsibilities',
          'user_permission_overrides',
          'user_responsibility_scopes',
          'permission_audit_logs'
        );
    `);
    console.table(resFk.rows);

    console.log("Checking indexes...");
    const resIndexes = await client.query(`
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename in (
          'responsibility_templates',
          'responsibility_template_permissions',
          'user_responsibilities',
          'role_responsibilities',
          'user_permission_overrides',
          'user_responsibility_scopes',
          'permission_audit_logs'
        )
      order by tablename, indexname;
    `);
    console.table(resIndexes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
