-- Add billing_trigger column to workflow_templates
ALTER TABLE workflow_templates 
ADD COLUMN IF NOT EXISTS billing_trigger text DEFAULT 'ON_WORKFLOW_COMPLETION';

-- Add billing_trigger column to workflow_steps
ALTER TABLE workflow_steps 
ADD COLUMN IF NOT EXISTS billing_trigger text DEFAULT 'ON_STEP_COMPLETION';

-- Ensure billing_invoices has source_ref and an index
ALTER TABLE billing_invoices
ADD COLUMN IF NOT EXISTS source_ref text;

CREATE INDEX IF NOT EXISTS idx_billing_source_ref
ON billing_invoices(source_type, source_ref);
