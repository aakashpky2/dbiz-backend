-- Migration: Drop unused Common Rules columns from workflow_templates
-- Date: 2026-05-22
-- These columns are no longer used by the application. Common Rules now only
-- covers: workflow_name, status, description, common_information_fields.

ALTER TABLE public.workflow_templates
DROP COLUMN IF EXISTS effective_from,
DROP COLUMN IF EXISTS effective_to,
DROP COLUMN IF EXISTS common_due_date_rule,
DROP COLUMN IF EXISTS common_finish_date_rule,
DROP COLUMN IF EXISTS default_priority,
DROP COLUMN IF EXISTS default_department_id,
DROP COLUMN IF EXISTS default_assigned_role,
DROP COLUMN IF EXISTS default_reminder_days_before,
DROP COLUMN IF EXISTS default_escalation_rule,
DROP COLUMN IF EXISTS default_approval_required,
DROP COLUMN IF EXISTS allow_step_override;

NOTIFY pgrst, 'reload schema';
