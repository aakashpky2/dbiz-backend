require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sql = `
CREATE TABLE IF NOT EXISTS public.user_active_work (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    work_id UUID REFERENCES public.works(id) ON DELETE SET NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    paused_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('assigned', 'claimed', 'in_progress', 'paused', 'completed', 'overdue')),
    elapsed_seconds INTEGER DEFAULT 0,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_active_work_user_id ON public.user_active_work(user_id);
CREATE INDEX IF NOT EXISTS idx_user_active_work_status ON public.user_active_work(status);
CREATE INDEX IF NOT EXISTS idx_user_active_work_work_id ON public.user_active_work(work_id);

-- trigger for updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON public.user_active_work;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON public.user_active_work
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
`;

async function run() {
    const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql });
    
    if (error) {
        // execute_sql might not exist, fallback to direct query if posgres connection is available, but supabase JS client can't run raw DDL directly unless via RPC.
        console.error('Error running RPC execute_sql:', error);
        console.log('Please run this SQL manually in the Supabase SQL Editor:');
        console.log(sql);
    } else {
        console.log('Migration successful:', data);
    }
}

run();
