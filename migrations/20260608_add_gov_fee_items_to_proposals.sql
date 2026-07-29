-- Migration: Add government_fee_items to proposals

DO $$ 
BEGIN
    -- Check if government_fee_items column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'proposals' 
        AND column_name = 'government_fee_items'
    ) THEN
        -- Add the JSONB column with default empty array
        ALTER TABLE proposals ADD COLUMN government_fee_items JSONB DEFAULT '[]';
    END IF;
END $$;
