-- Migration: 20260720_create_billing_number_series.sql
-- Create billing_number_series table with matching criteria and sequence counter

CREATE TABLE IF NOT EXISTS billing_number_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL,
  name VARCHAR(255) NOT NULL,
  
  -- Matching Criteria (At least one must be non-null)
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  work_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  constitution_id UUID REFERENCES business_constitutions(id) ON DELETE SET NULL,
  
  -- Fixed Format: PREFIX + PADDED SEQUENCE + SUFFIX
  prefix VARCHAR(50) NOT NULL DEFAULT '',
  starting_number BIGINT NOT NULL DEFAULT 1 CHECK (starting_number >= 1),
  current_number BIGINT NOT NULL DEFAULT 0,
  number_length INTEGER NOT NULL DEFAULT 6 CHECK (number_length >= 1),
  suffix VARCHAR(50) NOT NULL DEFAULT '',
  
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_by UUID NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT check_at_least_one_matching_field CHECK (
    business_profile_id IS NOT NULL OR
    client_id IS NOT NULL OR
    work_id IS NOT NULL OR
    constitution_id IS NOT NULL
  )
);

-- Index for active series lookup
CREATE INDEX IF NOT EXISTS idx_billing_number_series_active ON billing_number_series(is_active);
CREATE INDEX IF NOT EXISTS idx_billing_number_series_matching ON billing_number_series(business_profile_id, client_id, work_id, constitution_id);

-- Alter billing_invoices to add billing_number_series_id
ALTER TABLE billing_invoices 
ADD COLUMN IF NOT EXISTS billing_number_series_id UUID REFERENCES billing_number_series(id) ON DELETE SET NULL;
