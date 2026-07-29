-- Add sub_constitution_ids array to rate_card_items to support multiple sub-constitution mappings
ALTER TABLE rate_card_items ADD COLUMN IF NOT EXISTS sub_constitution_ids UUID[] DEFAULT '{}';
