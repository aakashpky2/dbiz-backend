ALTER TABLE rate_cards
DROP COLUMN IF EXISTS constitution_ids;

ALTER TABLE rate_cards
DROP COLUMN IF EXISTS sub_constitution_ids;

ALTER TABLE rate_cards
ADD COLUMN constitution_ids text[] DEFAULT '{}';

ALTER TABLE rate_cards
ADD COLUMN sub_constitution_ids text[] DEFAULT '{}';
