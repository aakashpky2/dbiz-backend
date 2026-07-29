-- Add new columns for professional fee ranges
ALTER TABLE rate_card_items
ADD COLUMN IF NOT EXISTS professional_fee_type text DEFAULT 'fixed',
ADD COLUMN IF NOT EXISTS professional_fee_min numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS professional_fee_max numeric DEFAULT 0;

-- Backfill existing items
UPDATE rate_card_items
SET 
  professional_fee_type = 'fixed',
  professional_fee_min = professional_fee,
  professional_fee_max = professional_fee
WHERE professional_fee_type IS NULL OR professional_fee_type = 'fixed';
