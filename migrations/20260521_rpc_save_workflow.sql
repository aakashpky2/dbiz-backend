-- Migration: Create save_workflow_v2 RPC for transactional saving of workflow templates and steps.
-- Ensures that if any step fails, the entire template save rolls back.

CREATE OR REPLACE FUNCTION save_workflow_v2(
  p_template JSONB,
  p_steps JSONB
) RETURNS JSONB AS $$
DECLARE
  v_template_id UUID;
  v_step JSONB;
  v_step_ids UUID[] := '{}';
BEGIN
  -- 1. Upsert the Template
  IF p_template ? 'id' AND (p_template->>'id') IS NOT NULL AND (p_template->>'id') <> '' THEN
    v_template_id := (p_template->>'id')::UUID;
    UPDATE workflow_templates
    SET
      work_type_id = (p_template->>'work_type_id')::UUID,
      workflow_name = p_template->>'workflow_name',
      description = p_template->>'description',
      scope = COALESCE(p_template->>'scope', 'GLOBAL'),
      client_id = NULLIF(p_template->>'client_id', '')::UUID,
      is_active = (p_template->>'is_active')::BOOLEAN,
      is_draft = (p_template->>'is_draft')::BOOLEAN,
      status = COALESCE(p_template->>'status', 'DRAFT'),
      version = COALESCE((p_template->>'version')::INTEGER, 1),
      effective_from = NULLIF(p_template->>'effective_from', '')::DATE,
      effective_to = NULLIF(p_template->>'effective_to', '')::DATE,
      common_due_date_rule = COALESCE(p_template->'common_due_date_rule', '{}'::jsonb),
      common_finish_date_rule = COALESCE(p_template->'common_finish_date_rule', '{}'::jsonb),
      default_priority = p_template->>'default_priority',
      default_department_id = NULLIF(p_template->>'default_department_id', '')::UUID,
      default_assigned_role = p_template->>'default_assigned_role',
      default_reminder_days_before = COALESCE((p_template->>'default_reminder_days_before')::INTEGER, 0),
      default_escalation_rule = COALESCE(p_template->'default_escalation_rule', '{}'::jsonb),
      default_approval_required = COALESCE((p_template->>'default_approval_required')::BOOLEAN, false),
      allow_step_override = COALESCE((p_template->>'allow_step_override')::BOOLEAN, true),
      inheritance_mode = COALESCE(p_template->>'inheritance_mode', 'INHERIT'),
      common_information_fields = COALESCE(p_template->'common_information_fields', '[]'::jsonb),
      updated_at = NOW()
    WHERE id = v_template_id;
  ELSE
    INSERT INTO workflow_templates (
      work_type_id, workflow_name, description, scope, client_id, is_active, is_draft, status,
      version, effective_from, effective_to, common_due_date_rule, common_finish_date_rule,
      default_priority, default_department_id, default_assigned_role, default_reminder_days_before,
      default_escalation_rule, default_approval_required, allow_step_override, inheritance_mode,
      common_information_fields
    ) VALUES (
      (p_template->>'work_type_id')::UUID,
      p_template->>'workflow_name',
      p_template->>'description',
      COALESCE(p_template->>'scope', 'GLOBAL'),
      NULLIF(p_template->>'client_id', '')::UUID,
      COALESCE((p_template->>'is_active')::BOOLEAN, true),
      COALESCE((p_template->>'is_draft')::BOOLEAN, true),
      COALESCE(p_template->>'status', 'DRAFT'),
      COALESCE((p_template->>'version')::INTEGER, 1),
      NULLIF(p_template->>'effective_from', '')::DATE,
      NULLIF(p_template->>'effective_to', '')::DATE,
      COALESCE(p_template->'common_due_date_rule', '{}'::jsonb),
      COALESCE(p_template->'common_finish_date_rule', '{}'::jsonb),
      p_template->>'default_priority',
      NULLIF(p_template->>'default_department_id', '')::UUID,
      p_template->>'default_assigned_role',
      COALESCE((p_template->>'default_reminder_days_before')::INTEGER, 0),
      COALESCE(p_template->'default_escalation_rule', '{}'::jsonb),
      COALESCE((p_template->>'default_approval_required')::BOOLEAN, false),
      COALESCE((p_template->>'allow_step_override')::BOOLEAN, true),
      COALESCE(p_template->>'inheritance_mode', 'INHERIT'),
      COALESCE(p_template->'common_information_fields', '[]'::jsonb)
    ) RETURNING id INTO v_template_id;
  END IF;

  -- 2. Upsert Steps
  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    IF v_step ? 'id' AND (v_step->>'id') IS NOT NULL AND (v_step->>'id') <> '' THEN
      v_step_ids := v_step_ids || (v_step->>'id')::UUID;
      UPDATE workflow_steps
      SET
        workflow_template_id = v_template_id,
        step_order = (v_step->>'step_order')::INTEGER,
        step_name = v_step->>'step_name',
        long_description = v_step->>'long_description',
        status = COALESCE(v_step->>'status', 'DRAFT'),
        step_type = v_step->>'step_type',
        video_enabled = COALESCE((v_step->>'video_enabled')::BOOLEAN, false),
        video_url = v_step->>'video_url',
        audio_enabled = COALESCE((v_step->>'audio_enabled')::BOOLEAN, false),
        audio_file_url = v_step->>'audio_file_url',
        document_fields = COALESCE(v_step->'document_fields', '[]'::jsonb),
        custom_fields = COALESCE(v_step->'custom_fields', '[]'::jsonb),
        step_due_date_rule = COALESCE(v_step->'step_due_date_rule', '{}'::jsonb),
        step_finish_date_rule = COALESCE(v_step->'step_finish_date_rule', '{}'::jsonb),
        is_mandatory = COALESCE((v_step->>'is_mandatory')::BOOLEAN, true),
        depends_on_step_ids = COALESCE(v_step->'depends_on_step_ids', '[]'::jsonb),
        assigned_department_id = NULLIF(v_step->>'assigned_department_id', '')::UUID,
        assigned_role = v_step->>'assigned_role',
        estimated_time = v_step->>'estimated_time',
        reminder_days_before = (v_step->>'reminder_days_before')::INTEGER,
        approval_required = (v_step->>'approval_required')::BOOLEAN,
        updated_at = NOW()
      WHERE id = (v_step->>'id')::UUID;
    ELSE
      INSERT INTO workflow_steps (
        workflow_template_id, step_order, step_name, long_description, status, step_type,
        video_enabled, video_url, audio_enabled, audio_file_url, document_fields, custom_fields,
        step_due_date_rule, step_finish_date_rule, is_mandatory, depends_on_step_ids,
        assigned_department_id, assigned_role, estimated_time, reminder_days_before, approval_required
      ) VALUES (
        v_template_id,
        (v_step->>'step_order')::INTEGER,
        v_step->>'step_name',
        v_step->>'long_description',
        COALESCE(v_step->>'status', 'DRAFT'),
        v_step->>'step_type',
        COALESCE((v_step->>'video_enabled')::BOOLEAN, false),
        v_step->>'video_url',
        COALESCE((v_step->>'audio_enabled')::BOOLEAN, false),
        v_step->>'audio_file_url',
        COALESCE(v_step->'document_fields', '[]'::jsonb),
        COALESCE(v_step->'custom_fields', '[]'::jsonb),
        COALESCE(v_step->'step_due_date_rule', '{}'::jsonb),
        COALESCE(v_step->'step_finish_date_rule', '{}'::jsonb),
        COALESCE((v_step->>'is_mandatory')::BOOLEAN, true),
        COALESCE(v_step->'depends_on_step_ids', '[]'::jsonb),
        NULLIF(v_step->>'assigned_department_id', '')::UUID,
        v_step->>'assigned_role',
        v_step->>'estimated_time',
        (v_step->>'reminder_days_before')::INTEGER,
        (v_step->>'approval_required')::BOOLEAN
      ) RETURNING id INTO v_step;
      v_step_ids := v_step_ids || (v_step->>'id')::UUID;
    END IF;
  END LOOP;

  -- 3. Soft-delete or Hard-delete old steps that are no longer present
  IF array_length(v_step_ids, 1) > 0 THEN
    DELETE FROM workflow_steps 
    WHERE workflow_template_id = v_template_id AND id != ALL(v_step_ids);
  ELSE
    DELETE FROM workflow_steps 
    WHERE workflow_template_id = v_template_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'template_id', v_template_id);
END;
$$ LANGUAGE plpgsql;
