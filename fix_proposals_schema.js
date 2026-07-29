
const { supabase } = require('./lib/supabase');

async function fixProposalsTable() {
    console.log('--- Fixing Proposals Table Schema ---');
    const sql = `
        ALTER TABLE public.proposals
        ADD COLUMN IF NOT EXISTS contacts JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS conversion_probability NUMERIC DEFAULT 50,
        ADD COLUMN IF NOT EXISTS last_follow_up_date DATE DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS sent_date TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'Pending Approval',
        ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0',
        ADD COLUMN IF NOT EXISTS processing_days NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS processing_hours NUMERIC DEFAULT 0;
    `;

    try {
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: sql
        });

        if (error) {
            console.error('Error executing SQL via RPC:', error);
            process.exit(1);
        } else {
            console.log('Successfully added missing columns to proposals table.');
            process.exit(0);
        }
    } catch (e) {
        console.error('Migration failed:', e.message);
        process.exit(1);
    }
}

fixProposalsTable();
