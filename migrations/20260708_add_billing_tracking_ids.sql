-- Add execution and template identifiers to billing_invoices
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS execution_instance_id UUID REFERENCES workflow_execution_instances(id) ON DELETE RESTRICT NULL;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS workflow_step_id UUID REFERENCES workflow_steps(id) ON DELETE RESTRICT NULL;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE RESTRICT NULL;
