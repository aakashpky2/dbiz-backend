-- Add business_profile_id to rate_cards table
ALTER TABLE rate_cards
ADD COLUMN business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL;

-- Create index for faster filtering
CREATE INDEX idx_rate_cards_business_profile_id ON rate_cards(business_profile_id);
