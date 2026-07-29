-- Migration: Move Fee Amount to Applicability Conditions
-- Date: 2026-06-12

ALTER TABLE government_fee_applicability_conditions
ADD COLUMN IF NOT EXISTS fee_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS calculation_type text DEFAULT 'fixed',
ADD COLUMN IF NOT EXISTS percentage_rate numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS minimum_fee numeric NULL,
ADD COLUMN IF NOT EXISTS maximum_fee numeric NULL;
