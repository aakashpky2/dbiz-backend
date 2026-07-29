-- Safely add source_ref column to prevent duplicate billing from identical tasks/steps
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS source_ref text;

CREATE INDEX IF NOT EXISTS idx_billing_source_ref
ON billing_invoices(source_type, source_ref);
