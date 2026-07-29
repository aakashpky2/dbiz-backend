-- 20260707_add_workflow_is_billable.sql
-- Description: Adds is_billable to workflow_templates for two-level billing architecture.

ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;
