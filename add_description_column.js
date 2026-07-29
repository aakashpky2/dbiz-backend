
/** 
 * Migration script to add description and update template fields.
 */
const { supabase } = require('./lib/supabase');

async function migrate() {
    console.log('--- Database Migration Started ---');
    try {
        // We'll execute raw SQL to add the column
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: `
                ALTER TABLE templates ADD COLUMN IF NOT EXISTS description text;
            `
        });

        if (error) {
            console.warn('RPC execute_sql failed, falling back to direct check.');
            // Some environments don't support raw SQL RPC easily, let's just log
            console.log('Skipping Alter Table if RPC not available. Ensure description column exists manually if needed.');
        } else {
             console.log('Column "description" added successfully.');
        }
        
    } catch (e) {
        console.error('Migration crashed:', e.message);
    }
}

migrate();
