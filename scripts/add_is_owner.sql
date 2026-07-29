ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_owner_super_admin BOOLEAN DEFAULT false;
