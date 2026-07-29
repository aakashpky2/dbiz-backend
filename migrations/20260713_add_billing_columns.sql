-- Verify existing schema
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workflow_steps' ORDER BY ordinal_position;

-- Add new columns
ALTER TABLE public.workflow_steps
ADD COLUMN IF NOT EXISTS billing_category text,
ADD COLUMN IF NOT EXISTS billing_trigger text;

-- Recommended constraints/defaults:
UPDATE public.workflow_steps
SET billing_trigger = 'ON_STEP_COMPLETION'
WHERE billing_trigger IS NULL
  AND is_billable = true;

-- Constraint already exists, so we skip adding it.
-- ALTER TABLE public.workflow_steps
-- ADD CONSTRAINT workflow_steps_billing_trigger_check
-- CHECK (
--   billing_trigger IS NULL
--   OR billing_trigger IN (
--     'ON_STEP_COMPLETION',
--     'ON_WORKFLOW_COMPLETION',
--     'MANUAL'
--   )
-- );

CREATE INDEX IF NOT EXISTS idx_workflow_steps_billing_trigger
ON public.workflow_steps(billing_trigger);

NOTIFY pgrst, 'reload schema';

-- Verify migration
-- SELECT id, step_name, is_billable, billing_category, billing_trigger FROM public.workflow_steps ORDER BY created_at DESC LIMIT 20;
