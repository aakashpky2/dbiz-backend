-- Migration to add source_type and source_id for Unified Billing
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'WORKFLOW';
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS source_id UUID;

-- Backfill source_id from existing workflow_step_instance_id
UPDATE public.billing_invoices 
SET source_type = 'STEP', source_id = workflow_step_instance_id 
WHERE workflow_step_instance_id IS NOT NULL AND source_id IS NULL;
