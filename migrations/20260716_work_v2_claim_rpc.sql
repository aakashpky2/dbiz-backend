-- backend/migrations/20260716_work_v2_claim_rpc.sql

-- Drop existing if needed
DROP FUNCTION IF EXISTS claim_workflow_step(uuid, uuid);

CREATE OR REPLACE FUNCTION claim_workflow_step(
  p_step_id uuid,
  p_employee_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS 
DECLARE
  v_step record;
  v_execution record;
  v_now timestamptz := now();
BEGIN
  -- 1. Row Locking Strategy
  SELECT * INTO v_step
  FROM workflow_step_instances
  WHERE id = p_step_id
  FOR UPDATE;

  IF v_step IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found.');
  END IF;

  -- 2. Idempotency Behavior
  -- If same employee already claimed and it's in progress, return success without duplicating logs
  IF v_step.claimed_by = p_employee_id AND v_step.status = 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Step already claimed and started by you.');
  END IF;

  -- If claimed by someone else
  IF v_step.claimed_by IS NOT NULL AND v_step.claimed_by != p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step is already claimed by another user.');
  END IF;

  -- If not AVAILABLE
  IF v_step.status != 'AVAILABLE' AND v_step.status != 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step is not available to be claimed. Current status: ' || v_step.status);
  END IF;

  -- 3. Update Step (Claim & Start)
  UPDATE workflow_step_instances
  SET status = 'IN_PROGRESS',
      claimed_by = p_employee_id,
      assigned_member_id = p_employee_id,
      actual_started_at = COALESCE(v_step.actual_started_at, v_now),
      updated_at = v_now
  WHERE id = p_step_id;

  -- 4. Fetch Execution Details for Activity Log
  SELECT * INTO v_execution
  FROM workflow_execution_instances
  WHERE id = v_step.execution_instance_id
  FOR UPDATE;

  -- 5. Insert Log (Only if transition from AVAILABLE to IN_PROGRESS)
  IF v_step.status = 'AVAILABLE' THEN
    INSERT INTO workflow_step_activity_logs (
      step_instance_id, work_id, action, old_status, new_status, performed_by
    ) VALUES (
      p_step_id, v_execution.work_id, 'CLAIMED', 'AVAILABLE', 'IN_PROGRESS', p_employee_id
    );
  END IF;

  -- 6. Cascade Progress Status
  IF v_execution.status = 'NOT_STARTED' THEN
    UPDATE workflow_execution_instances
    SET status = 'IN_PROGRESS'
    WHERE id = v_execution.id;

    UPDATE works
    SET workflow_status = 'IN_PROGRESS'
    WHERE id = v_execution.work_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Step claimed successfully');
END;
;
