-- 1. Create company_settings table if it does not exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
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

-- 2. Add Business Profile support safely
ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS business_profile_id uuid NULL,
ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

-- 3. Add FK safely if business_profiles table exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
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

-- 4. Create uniqueness guards and indexes
CREATE INDEX IF NOT EXISTS idx_company_settings_profile
ON public.company_settings(business_profile_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_settings_active_profile
ON public.company_settings(business_profile_id)
WHERE status = 'active' AND business_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_settings_global_default
ON public.company_settings(is_default)
WHERE status = 'active' AND business_profile_id IS NULL AND is_default = true;

-- Ensure RLS is enabled if needed (optional based on your setup)
-- ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
