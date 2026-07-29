ALTER TABLE rate_cards
ADD CONSTRAINT fk_rate_cards_business_profile
FOREIGN KEY (business_profile_id)
REFERENCES business_profiles(id)
ON DELETE SET NULL;
