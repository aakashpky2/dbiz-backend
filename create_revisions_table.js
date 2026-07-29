
const { supabase } = require('./lib/supabase');

async function run() {
    console.log('--- Creating proposal_revisions table ---');
    
    const { error: tableError } = await supabase.rpc('execute_sql', {
        sql_query: `
            CREATE TABLE IF NOT EXISTS public.proposal_revisions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
                revision_number INTEGER NOT NULL,
                previous_version TEXT,
                new_version TEXT,
                previous_stage TEXT,
                new_stage TEXT,
                client_requested_changes TEXT,
                previous_snapshot JSONB NOT NULL,
                revised_snapshot JSONB,
                changed_fields JSONB DEFAULT '[]'::jsonb,
                revised_by UUID NULL,
                revised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_proposal_revisions_proposal_id
            ON public.proposal_revisions(proposal_id);

            CREATE INDEX IF NOT EXISTS idx_proposal_revisions_revised_at
            ON public.proposal_revisions(revised_at DESC);

            -- Ensure version column exists in proposals
            ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0';
        `
    });

    if (tableError) {
        console.error('Error creating table:', tableError);
    } else {
        console.log('Successfully created proposal_revisions table and ensured version column.');
    }
}

run();
