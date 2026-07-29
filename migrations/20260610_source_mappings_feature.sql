-- Migration: Source Mapping feature for Government Fees

-- 1. Create the source mappings table
CREATE TABLE IF NOT EXISTS government_fee_source_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_column TEXT NOT NULL,
    source_json_path TEXT DEFAULT '',
    data_type TEXT NOT NULL,
    category TEXT NULL,
    is_visible BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    description TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(source_table, source_column)
);

-- 2. Alter applicability conditions table to add mapping_id
ALTER TABLE government_fee_applicability_conditions
ADD COLUMN IF NOT EXISTS mapping_id UUID REFERENCES government_fee_source_mappings(id) ON DELETE SET NULL;

-- 3. We keep source_table, source_column, and source_json_path for rollback,
-- but they are no longer required going forward.

-- Optional: Add some standard default mappings for immediate usage if the table is empty
INSERT INTO government_fee_source_mappings (display_name, source_table, source_column, data_type, category, description)
SELECT 'State', 'business_profiles', 'state', 'text', 'Business Info', 'State of the business profile'
WHERE NOT EXISTS (SELECT 1 FROM government_fee_source_mappings WHERE source_table = 'business_profiles' AND source_column = 'state');

INSERT INTO government_fee_source_mappings (display_name, source_table, source_column, data_type, category, description)
SELECT 'District', 'business_profiles', 'district', 'text', 'Business Info', 'District of the business profile'
WHERE NOT EXISTS (SELECT 1 FROM government_fee_source_mappings WHERE source_table = 'business_profiles' AND source_column = 'district');

INSERT INTO government_fee_source_mappings (display_name, source_table, source_column, data_type, category, description)
SELECT 'Constitution', 'business_profiles', 'constitution', 'text', 'Business Info', 'Business Constitution'
WHERE NOT EXISTS (SELECT 1 FROM government_fee_source_mappings WHERE source_table = 'business_profiles' AND source_column = 'constitution');
