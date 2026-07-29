-- Migration: Add Performance Indexes
-- Date: 2026-06-12

-- Add index on rate_cards status and approval_status
CREATE INDEX IF NOT EXISTS idx_rate_cards_status ON rate_cards(status);
CREATE INDEX IF NOT EXISTS idx_rate_cards_approval_status ON rate_cards(approval_status);

-- Add index on government_fee_library status
CREATE INDEX IF NOT EXISTS idx_government_fee_library_status ON government_fee_library(status);

-- Add index on attendance timestamp
CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance(timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON attendance(user_id);

-- Add index on proposals status
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
