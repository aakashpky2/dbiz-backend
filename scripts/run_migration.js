const { supabase } = require('../lib/supabase');

const sql = `
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'company_settings'
    ) THEN
        CREATE TABLE public.company_settings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            company_name text,
            address text,
            email text,
            phone text,
            gstin text,
            website text,
            logo_url text,
            seal_url text,
            signature_url text,
            status text DEFAULT 'active',
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
        );
    END IF;
END $$;

ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS business_profile_id uuid NULL,
ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

DO $$ 
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'business_profiles'
    ) THEN
        BEGIN
            ALTER TABLE public.company_settings
            ADD CONSTRAINT company_settings_business_profile_id_fkey
            FOREIGN KEY (business_profile_id)
            REFERENCES public.business_profiles(id)
            ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_settings_profile
ON public.company_settings(business_profile_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_settings_active_profile
ON public.company_settings(business_profile_id)
WHERE status = 'active' AND business_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_settings_global_default
ON public.company_settings(is_default)
WHERE status = 'active' AND business_profile_id IS NULL AND is_default = true;
`;

async function run() {
    try {
        console.log("Running migration...");
        
        // Supabase Data API does not support raw query execution safely.
        // We can execute SQL functions, or use PostgREST RPC if defined.
        // Since we might not have a general exec_sql rpc, we'll try to use pg directly 
        // if possible, but we don't have access to connection string here normally.
        console.log("SQL to execute via Supabase Dashboard SQL Editor:");
        console.log(sql);
        
        console.log("\\nPlease execute the above SQL in the Supabase Dashboard SQL Editor.");
        
    } catch (e) {
        console.error(e);
    }
}

run();
