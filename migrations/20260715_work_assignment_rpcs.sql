-- 20260715_work_assignment_rpcs.sql
-- Safely creates assignment transaction RPCs

CREATE OR REPLACE FUNCTION assign_work_to_team(
  p_work_id uuid,
  p_team_id uuid,
  p_assigned_by_name text
) RETURNS jsonb AS $body
DECLARE
  v_updated_work jsonb;
BEGIN
  UPDATE works SET
    assigned_team_id = p_team_id,
    assignment_status = 'TEAM_ASSIGNED',
    workflow_status = 'AVAILABLE',
    current_handler_id = NULL
  WHERE id = p_work_id;

  INSERT INTO work_assignment_history (
    work_id, new_team_id, performed_by, action
  ) VALUES (
    p_work_id, p_team_id, p_assigned_by_name, 'TEAM_ASSIGNED'
  );

  SELECT to_jsonb(w.*) INTO v_updated_work FROM works w WHERE id = p_work_id;
  RETURN v_updated_work;
END;
$body LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION reassign_work_to_team(
  p_work_id uuid,
  p_new_team_id uuid,
  p_assigned_by_name text,
  p_reason text
) RETURNS jsonb AS $body
DECLARE
  v_old_team_id uuid;
  v_updated_work jsonb;
BEGIN
  SELECT assigned_team_id INTO v_old_team_id FROM works WHERE id = p_work_id;

  UPDATE works SET
    assigned_team_id = p_new_team_id,
    assignment_status = 'TEAM_ASSIGNED',
    workflow_status = 'AVAILABLE',
    current_handler_id = NULL
  WHERE id = p_work_id;

  INSERT INTO work_assignment_history (
    work_id, old_team_id, new_team_id, performed_by, action, reason
  ) VALUES (
    p_work_id, v_old_team_id, p_new_team_id, p_assigned_by_name, 'REASSIGNED_TEAM', p_reason
  );

  SELECT to_jsonb(w.*) INTO v_updated_work FROM works w WHERE id = p_work_id;
  RETURN v_updated_work;
END;
$body LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION assign_work_item_to_member(
  p_work_id uuid,
  p_work_item_id uuid,
  p_team_id uuid,
  p_member_id uuid,
  p_assigned_by_name text
) RETURNS jsonb AS $body
DECLARE
  v_old_member_id uuid;
  v_action text;
  v_updated_work jsonb;
BEGIN
  -- Get existing assignment if any
  SELECT assigned_member_id INTO v_old_member_id 
  FROM work_member_assignments 
  WHERE work_id = p_work_id AND (work_item_id = p_work_item_id OR (work_item_id IS NULL AND p_work_item_id IS NULL));

  IF v_old_member_id IS NOT NULL THEN
    v_action := 'REASSIGNED_MEMBER';
  ELSE
    v_action := 'MEMBER_ASSIGNED';
  END IF;

  INSERT INTO work_member_assignments (
    work_id, work_item_id, team_id, assigned_member_id, assigned_by, updated_at
  ) VALUES (
    p_work_id, p_work_item_id, p_team_id, p_member_id, p_assigned_by_name, NOW()
  )
  ON CONFLICT (work_id, work_item_id, assigned_member_id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    assigned_by = EXCLUDED.assigned_by,
    updated_at = NOW();

  UPDATE works SET
    assignment_status = 'MEMBER_ASSIGNED',
    current_handler_id = p_member_id,
    workflow_status = 'CLAIMED'
  WHERE id = p_work_id;

  INSERT INTO work_assignment_history (
    work_id, old_member_id, new_member_id, performed_by, action
  ) VALUES (
    p_work_id, v_old_member_id, p_member_id, p_assigned_by_name, v_action
  );

  SELECT to_jsonb(w.*) INTO v_updated_work FROM works w WHERE id = p_work_id;
  RETURN v_updated_work;
END;
$body LANGUAGE plpgsql SECURITY DEFINER;
