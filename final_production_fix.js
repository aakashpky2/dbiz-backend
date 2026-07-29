
const { supabase } = require('./lib/supabase');

async function runFix() {
    console.log('--- Final Production Schema Fix ---');
    
    const sql = `
        -- 1. Fix proposal_send_logs table
        -- Add missing columns if they don't exist
        ALTER TABLE public.proposal_send_logs 
        ADD COLUMN IF NOT EXISTS sender_name TEXT,
        ADD COLUMN IF NOT EXISTS sender_email TEXT,
        ADD COLUMN IF NOT EXISTS interaction_method TEXT,
        ADD COLUMN IF NOT EXISTS profile_id UUID;

        -- Ensure they are nullable (if they were NOT NULL, this would fail if data exists)
        ALTER TABLE public.proposal_send_logs 
        ALTER COLUMN sender_name DROP NOT NULL,
        ALTER COLUMN sender_email DROP NOT NULL;

        -- 2. Ensure proposal_history has consistent columns
        ALTER TABLE public.proposal_history 
        ADD COLUMN IF NOT EXISTS performed_at TIMESTAMPTZ DEFAULT now();

        -- 3. Ensure proposals table has all columns mentioned in formats
        ALTER TABLE public.proposals
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sent_by_name TEXT,
        ADD COLUMN IF NOT EXISTS sent_by_email TEXT,
        ADD COLUMN IF NOT EXISTS sent_by_position TEXT,
        ADD COLUMN IF NOT EXISTS sent_by_phone TEXT;

        -- 4. Create proposal_revisions table for snapshotting
        CREATE TABLE IF NOT EXISTS public.proposal_revisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            proposal_id UUID REFERENCES public.proposals(id) ON DELETE CASCADE,
            revision_number INTEGER,
            previous_version TEXT,
            new_version TEXT,
            previous_stage TEXT,
            new_stage TEXT,
            client_requested_changes TEXT,
            previous_snapshot JSONB,
            revised_snapshot JSONB,
            changed_fields JSONB,
            revised_by TEXT,
            revised_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_proposal_revisions_proposal_id ON public.proposal_revisions(proposal_id);
    `;

    try {
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: sql
        });

        if (error) {
            console.error('Error executing SQL:', error);
            // If RPC fails, we might need to use another way, but typically this is the setup
        } else {
            console.log('Successfully applied schema fixes.');
        }
    } catch (e) {
        console.error('Fix execution failed:', e.message);
    }
    
    process.exit(0);
}

runFix();
