-- 20260519_create_workflow_execution_instances.sql
-- Create runtime tables for workflow execution instances, steps instances, and activity logs.

-- 1. WORKFLOW EXECUTION INSTANCES
CREATE TABLE IF NOT EXISTS workflow_execution_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID UNIQUE REFERENCES works(id) ON DELETE CASCADE, -- Unique: guarantees no duplicate executions per work item
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    work_type_id UUID REFERENCES work_types(id) ON DELETE CASCADE,
    workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
    workflow_version INT NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED' 
        CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED')),
    assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    current_handler_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    planned_start_date TIMESTAMPTZ,
    planned_finish_date TIMESTAMPTZ,
    actual_started_at TIMESTAMPTZ,
    actual_completed_at TIMESTAMPTZ,
    progress_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for lookup speed
CREATE INDEX IF NOT EXISTS idx_exec_instances_work ON workflow_execution_instances(work_id);
CREATE INDEX IF NOT EXISTS idx_exec_instances_team ON workflow_execution_instances(assigned_team_id, status);

-- 2. WORKFLOW STEP INSTANCES
CREATE TABLE IF NOT EXISTS workflow_step_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_instance_id UUID REFERENCES workflow_execution_instances(id) ON DELETE CASCADE,
    workflow_step_id UUID REFERENCES workflow_steps(id) ON DELETE SET NULL,
    step_order INT NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    step_type VARCHAR(50) NOT NULL, -- 'document_collection', 'form_filling', 'approval_gate', 'manual_checklist'
    status VARCHAR(30) NOT NULL DEFAULT 'LOCKED'
        CHECK (status IN ('LOCKED', 'AVAILABLE', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'AT_RISK', 'OVERDUE', 'SKIPPED')),
    depends_on_step_instance_ids UUID[] DEFAULT '{}',
    assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    assigned_member_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    claimed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    planned_start_date TIMESTAMPTZ,
    planned_finish_date TIMESTAMPTZ,
    expected_duration_value INT DEFAULT 0,
    expected_duration_unit VARCHAR(20) DEFAULT 'days' CHECK (expected_duration_unit IN ('minutes', 'hours', 'days')),
    actual_started_at TIMESTAMPTZ,
    actual_completed_at TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    finish_by_date TIMESTAMPTZ,
    completed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    remarks TEXT,
    document_values JSONB DEFAULT '{}',
    custom_field_values JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_instances_exec ON workflow_step_instances(execution_instance_id);
CREATE INDEX IF NOT EXISTS idx_step_instances_team_status ON workflow_step_instances(assigned_team_id, status);
CREATE INDEX IF NOT EXISTS idx_step_instances_member ON workflow_step_instances(assigned_member_id, status);

-- 3. WORKFLOW STEP ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS workflow_step_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_instance_id UUID REFERENCES workflow_step_instances(id) ON DELETE CASCADE,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'CLAIMED', 'COMPLETED', 'STATUS_CHANGE', 'FIELDS_SAVED'
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    performed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
