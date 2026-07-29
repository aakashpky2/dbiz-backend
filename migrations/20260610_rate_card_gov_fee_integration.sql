-- 20260610_rate_card_gov_fee_integration.sql

-- Add new columns to rate_card_government_fees
ALTER TABLE rate_card_government_fees
    ADD COLUMN IF NOT EXISTS government_fee_rule_id uuid,
    ADD COLUMN IF NOT EXISTS authority_name text,
    ADD COLUMN IF NOT EXISTS calculation_type text,
    ADD COLUMN IF NOT EXISTS condition_snapshot jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS matched_values jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS matched_at timestamptz;

-- Add new columns to rate_card_items
ALTER TABLE rate_card_items
    ADD COLUMN IF NOT EXISTS government_fee_filter_values jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS government_fee_calculation_mode text DEFAULT 'dynamic';
