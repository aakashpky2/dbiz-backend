ALTER TABLE rate_cards
ADD COLUMN IF NOT EXISTS constitution_ids text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS sub_constitution_ids text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS business_profile_ids uuid[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS client_types text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS associate_ids uuid[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS client_ids uuid[] DEFAULT '{}';
