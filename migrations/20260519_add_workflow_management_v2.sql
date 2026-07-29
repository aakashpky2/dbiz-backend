-- ==========================================
-- Workflow Management V2 Phase 1 Migration
-- Description: Creates workflow_templates and workflow_steps tables for the new decoupled workflow system.
-- Does NOT touch existing Add Work, Clients, or client_workflows tables.
-- ==========================================

-- Enable UUID extension if not already enabled (usually enabled in Supabase by default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create workflow_templates table
CREATE TABLE IF NOT EXISTS workflow_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_type_id UUID NOT NULL,
    workflow_name TEXT NOT NULL,
    description TEXT,
    scope TEXT DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL', 'CLIENT')),
    client_id UUID,
    is_active BOOLEAN DEFAULT true,
    is_draft BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
    version INTEGER DEFAULT 1,
    effective_from DATE NULL,
    effective_to DATE NULL,
    common_due_date_rule JSONB DEFAULT '{}'::jsonb,
    common_finish_date_rule JSONB DEFAULT '{}'::jsonb,
    default_priority TEXT,
    default_department_id UUID NULL,
    default_assigned_role TEXT NULL,
    default_reminder_days_before INTEGER DEFAULT 0,
    default_escalation_rule JSONB DEFAULT '{}'::jsonb,
    default_approval_required BOOLEAN DEFAULT false,
    allow_step_override BOOLEAN DEFAULT true,
    inheritance_mode TEXT DEFAULT 'INHERIT' CHECK (inheritance_mode IN ('INHERIT', 'FREEZE')),
    cloned_from_workflow_id UUID NULL,
    clone_label TEXT NULL,
    lineage_root_id UUID NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create workflow_steps table
CREATE TABLE IF NOT EXISTS workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    long_description TEXT,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
    step_type TEXT,
    video_enabled BOOLEAN DEFAULT false,
    video_url TEXT,
    audio_enabled BOOLEAN DEFAULT false,
    audio_file_url TEXT,
    document_fields JSONB DEFAULT '[]'::jsonb,
    custom_fields JSONB DEFAULT '[]'::jsonb,
    step_due_date_rule JSONB DEFAULT '{}'::jsonb,
    step_finish_date_rule JSONB DEFAULT '{}'::jsonb,
    is_mandatory BOOLEAN DEFAULT true,
    depends_on_step_ids JSONB DEFAULT '[]'::jsonb,
    assigned_department_id UUID NULL,
    assigned_role TEXT NULL,
    estimated_time TEXT,
    reminder_days_before INTEGER NULL,
    approval_required BOOLEAN NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_templates_work_type ON workflow_templates(work_type_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_client ON workflow_templates(client_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_status ON workflow_templates(status);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_scope ON workflow_templates(scope);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_template_id ON workflow_steps(workflow_template_id);

-- Note: RLS (Row Level Security) and Policies can be configured here if necessary, 
-- but omitted to maintain compatibility with existing admin full-access patterns.
