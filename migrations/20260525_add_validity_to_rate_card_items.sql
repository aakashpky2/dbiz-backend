-- Add validity fields to rate_card_items
ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS applicable_from DATE;
ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS applicability_mode TEXT DEFAULT 'until_next_rate';
ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS applicable_until DATE;
