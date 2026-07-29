-- Migration: Add pending_order column to works table
-- Created: 2026-05-07

ALTER TABLE works ADD COLUMN IF NOT EXISTS pending_order INTEGER;

-- Optional: Add index for performance if sorting by pending_order is frequent
-- CREATE INDEX IF NOT EXISTS idx_works_pending_order ON works (pending_order);
