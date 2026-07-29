-- 1. Add missing internal tracking and tax tracking columns
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS internal_bill_no VARCHAR(50);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS tax_invoice_no VARCHAR(50);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS is_tax_invoice BOOLEAN DEFAULT FALSE;

-- 2. Add missing snapshot columns (for audit/historical integrity)
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_client_name VARCHAR(255);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_client_gstin VARCHAR(50);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_client_address TEXT;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_work_name VARCHAR(255);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_step_name VARCHAR(255);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_profile_name VARCHAR(255);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_profile_gstin VARCHAR(50);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS snapshot_profile_address TEXT;

-- 3. Add missing approval and preparation tracking columns
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS prepared_by UUID;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS tax_invoice_generated_at TIMESTAMPTZ;

-- 4. Set uniqueness constraints where applicable
-- (Ensuring we don't crash if the constraint already exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoices_internal_bill_no_key') THEN
        ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_internal_bill_no_key UNIQUE (internal_bill_no);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoices_tax_invoice_no_key') THEN
        ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_tax_invoice_no_key UNIQUE (tax_invoice_no);
    END IF;
END $$;

-- 5. Map work_id foreign key to tasks instead of deprecated works
DO $$
BEGIN
    ALTER TABLE billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_work_id_fkey;
EXCEPTION WHEN OTHERS THEN
    -- Ignore error if constraint doesn't exist
END $$;

ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_work_id_fkey FOREIGN KEY (work_id) REFERENCES tasks(id) ON DELETE RESTRICT;

-- 6. Relax invoice_no constraint
ALTER TABLE billing_invoices ALTER COLUMN invoice_no DROP NOT NULL;

-- 7. Refresh PostgREST schema cache so API picks up the changes immediately
NOTIFY pgrst, 'reload schema';
