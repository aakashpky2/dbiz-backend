ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS constitution_id UUID REFERENCES business_constitutions(id) ON DELETE SET NULL;
ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS constitution_scope TEXT;
