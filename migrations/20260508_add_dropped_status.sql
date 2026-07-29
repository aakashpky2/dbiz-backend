-- Migration to support "Dropped" status for queries
-- 1. Ensure the status constraint allows "Dropped"
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'queries_status_check' 
        AND table_name = 'queries'
    ) THEN
        ALTER TABLE queries DROP CONSTRAINT queries_status_check;
    END IF;
END $$;

ALTER TABLE queries
ADD CONSTRAINT queries_status_check
CHECK (status IN ('Open', 'Working', 'Resolved', 'Closed', 'Proposal Generated', 'Dropped'));

-- 2. Safe migration of existing Closed records to Dropped if remarks contain "Dropped"
UPDATE queries
SET status = 'Dropped'
WHERE status = 'Closed'
AND (remarks ILIKE '%Dropped%' OR query_details ILIKE '%Dropped%');
