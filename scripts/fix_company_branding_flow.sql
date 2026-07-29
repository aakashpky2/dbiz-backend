-- --------------------------------------------------
-- PART 1: Database must save properly
-- --------------------------------------------------

-- Ensure all required columns exist in company_settings
ALTER TABLE company_settings
ADD COLUMN IF NOT EXISTS business_profile_id uuid NULL,
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS gstin text,
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS seal_url text,
ADD COLUMN IF NOT EXISTS signature_url text,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_company_settings_profile
ON company_settings(business_profile_id, status);

-- Optional constraint to prevent duplicate active profiles (uncomment if desired)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_company_setting 
-- ON company_settings (business_profile_id) 
-- WHERE status = 'active' AND business_profile_id IS NOT NULL;

-- --------------------------------------------------
-- PART 2: RLS on company_settings
-- --------------------------------------------------

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_settings_authenticated_select" ON public.company_settings;
CREATE POLICY "company_settings_authenticated_select"
ON public.company_settings
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "company_settings_authenticated_insert" ON public.company_settings;
CREATE POLICY "company_settings_authenticated_insert"
ON public.company_settings
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "company_settings_authenticated_update" ON public.company_settings;
CREATE POLICY "company_settings_authenticated_update"
ON public.company_settings
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- --------------------------------------------------
-- PART 3: Storage bucket and RLS

-- Ensure bucket is public (must be done in Supabase UI or via API, SQL cannot directly alter bucket public status easily, but below are the required policies)

CREATE POLICY "company_assets_authenticated_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "company_assets_public_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-assets');

CREATE POLICY "company_assets_authenticated_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'company-assets')
WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "company_assets_authenticated_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'company-assets');
