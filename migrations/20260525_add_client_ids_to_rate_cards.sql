-- Add client_ids column to rate_cards supporting multi-client rate cards
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS client_ids UUID[] DEFAULT '{}';

-- Migrate existing client_id values to client_ids array for legacy compatibility
UPDATE rate_cards
SET client_ids = ARRAY[client_id]
WHERE client_id IS NOT NULL AND (client_ids IS NULL OR cardinality(client_ids) = 0);
