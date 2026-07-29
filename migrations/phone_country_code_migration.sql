-- ═══════════════════════════════════════════════════════════════════════════
-- Phone Number & Country Code — Safe Migration Script
-- Run in Supabase SQL Editor (safe — uses IF NOT EXISTS everywhere)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. QUERIES TABLE ────────────────────────────────────────────────────────
-- Already has contact_number and contact_country_code per queries.js audit.
-- Ensure column exists with safe default.
ALTER TABLE queries ADD COLUMN IF NOT EXISTS contact_country_code TEXT DEFAULT '+91';

-- Normalize existing contact_number values that are stored as bare 10 digits
-- (prepend +91) — SAFE: only updates rows where contact_number is exactly 10 digits
UPDATE queries
SET contact_country_code = '+91'
WHERE contact_country_code IS NULL OR contact_country_code = '' OR contact_country_code = 'India';

-- ─── 2. TEMPORARY_CLIENTS TABLE ─────────────────────────────────────────────
ALTER TABLE temporary_clients ADD COLUMN IF NOT EXISTS contact_country_code TEXT DEFAULT '+91';

UPDATE temporary_clients
SET contact_country_code = '+91'
WHERE contact_country_code IS NULL OR contact_country_code = '' OR contact_country_code = 'India';

-- ─── 3. CLIENTS TABLE ────────────────────────────────────────────────────────
-- clients stores phone inside contacts JSONB and manual_contact JSONB.
-- No direct phone column typically — but add country_code for safety.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+91';

-- ─── 4. ASSOCIATES TABLE ─────────────────────────────────────────────────────
ALTER TABLE associates ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+91';

-- Normalize any existing phone values that are stored without country code
UPDATE associates
SET country_code = '+91'
WHERE country_code IS NULL OR country_code = '' OR country_code = 'India';

-- ─── 5. PROPOSALS — temp_clients table ───────────────────────────────────────
-- The temp_clients table used by proposals/temp-clients route
ALTER TABLE temp_clients ADD COLUMN IF NOT EXISTS contact_country_code TEXT DEFAULT '+91';

UPDATE temp_clients
SET contact_country_code = '+91'
WHERE contact_country_code IS NULL OR contact_country_code = '';

-- ─── 6. EMPLOYEES — emergency contacts are stored in employee_emergency_contacts
-- Check actual table name and columns.
-- Add country_code to emergency contacts if table exists.
-- These are safe no-ops if the table doesn't have the column yet.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'employee_emergency_contacts'
    ) THEN
        ALTER TABLE employee_emergency_contacts ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+91';
    END IF;
END $$;

-- ─── 7. DATA NORMALIZATION — Queries enquiry_contacts JSONB ──────────────────
-- For JSONB arrays, we do NOT mass-update. Backend lazy-normalizes on next save.
-- This is intentional for safety.

-- ─── 8. VERIFY ───────────────────────────────────────────────────────────────
-- Run these SELECT statements to verify after migration:
-- SELECT id, contact_number, contact_country_code FROM queries LIMIT 10;
-- SELECT id, phone, country_code FROM associates LIMIT 10;
-- SELECT id, contact_number, contact_country_code FROM temporary_clients LIMIT 10;
