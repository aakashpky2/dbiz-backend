-- 20260715_create_works_transaction_rpc.sql
-- Safely inserts works and their creation audit trail atomically.

CREATE OR REPLACE FUNCTION create_works_with_tracking(
  p_works jsonb,
  p_actor_auth_user_id uuid,
  p_actor_name text
)
RETURNS jsonb AS $body
DECLARE
  v_work jsonb;
  v_inserted_work jsonb;
  v_result jsonb = '[]'::jsonb;
  v_work_id uuid;
BEGIN
  IF jsonb_typeof(p_works) != 'array' THEN
    RAISE EXCEPTION 'p_works must be a JSON array';
  END IF;

  FOR v_work IN SELECT * FROM jsonb_array_elements(p_works)
  LOOP
    INSERT INTO works (
      client_id, department_id, category_id, work_type_id, 
      client_name, department_name, category_name, work_type_name, work_type_status,
      occurrence, financial_year, period, priority, reference_type, 
      associate_id, associate_name, associate_effective_date, 
      due_date, finish_by_date, finish_by_time, duration_days, duration_hours, 
      status, entered_by, entered_by_name, entered_date, entered_time, remarks, 
      proposal_id, professional_fee, government_fee, gst_percentage, gst_amount, total_amount, 
      pending_order, workflow_status, assignment_status
    ) VALUES (
      (v_work->>'client_id')::uuid,
      (v_work->>'department_id')::uuid,
      (v_work->>'category_id')::uuid,
      (v_work->>'work_type_id')::uuid,
      v_work->>'client_name',
      v_work->>'department_name',
      v_work->>'category_name',
      v_work->>'work_type_name',
      v_work->>'work_type_status',
      v_work->>'occurrence',
      v_work->>'financial_year',
      v_work->>'period',
      v_work->>'priority',
      v_work->>'reference_type',
      NULLIF(v_work->>'associate_id', '')::uuid,
      v_work->>'associate_name',
      NULLIF(v_work->>'associate_effective_date', '')::date,
      NULLIF(v_work->>'due_date', '')::date,
      NULLIF(v_work->>'finish_by_date', '')::date,
      NULLIF(v_work->>'finish_by_time', '')::time,
      COALESCE((v_work->>'duration_days')::int, 0),
      COALESCE((v_work->>'duration_hours')::int, 0),
      v_work->>'status',
      p_actor_auth_user_id,
      p_actor_name,
      NULLIF(v_work->>'entered_date', '')::date,
      NULLIF(v_work->>'entered_time', '')::time,
      v_work->>'remarks',
      NULLIF(v_work->>'proposal_id', '')::uuid,
      (v_work->>'professional_fee')::numeric,
      (v_work->>'government_fee')::numeric,
      (v_work->>'gst_percentage')::numeric,
      (v_work->>'gst_amount')::numeric,
      (v_work->>'total_amount')::numeric,
      (v_work->>'pending_order')::int,
      COALESCE(v_work->>'workflow_status', 'AVAILABLE'),
      COALESCE(v_work->>'assignment_status', 'UNASSIGNED')
    )
    RETURNING id INTO v_work_id;

    SELECT to_jsonb(w.*) INTO v_inserted_work FROM works w WHERE w.id = v_work_id;

    -- Ensure tracking row is created, bypassing flawed triggers
    INSERT INTO work_tracking (
      work_id, type, by, uid, at, status
    ) VALUES (
      v_work_id, 'CREATED', p_actor_name, p_actor_auth_user_id, NOW(), v_work->>'status'
    );

    v_result := v_result || v_inserted_work;
  END LOOP;

  RETURN v_result;
END;
$body LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION update_work_with_tracking(
  p_work_id uuid,
  p_updates jsonb,
  p_actor_auth_user_id uuid,
  p_actor_name text
)
RETURNS jsonb AS $body
DECLARE
  v_updated_work jsonb;
  v_new_status text;
BEGIN
  -- We allow an explicit list of updatable fields from the dialog
  UPDATE works SET
    client_id = COALESCE((p_updates->>'client_id')::uuid, client_id),
    client_name = COALESCE(p_updates->>'client_name', client_name),
    department_id = COALESCE((p_updates->>'department_id')::uuid, department_id),
    department_name = COALESCE(p_updates->>'department_name', department_name),
    category_id = COALESCE((p_updates->>'category_id')::uuid, category_id),
    category_name = COALESCE(p_updates->>'category_name', category_name),
    work_type_id = COALESCE((p_updates->>'work_type_id')::uuid, work_type_id),
    work_type_name = COALESCE(p_updates->>'work_type_name', work_type_name),
    work_type_status = COALESCE(p_updates->>'work_type_status', work_type_status),
    occurrence = COALESCE(p_updates->>'occurrence', occurrence),
    financial_year = COALESCE(p_updates->>'financial_year', financial_year),
    period = COALESCE(p_updates->>'period', period),
    priority = COALESCE(p_updates->>'priority', priority),
    reference_type = COALESCE(p_updates->>'reference_type', reference_type),
    associate_id = CASE WHEN p_updates ? 'associate_id' THEN NULLIF(p_updates->>'associate_id', '')::uuid ELSE associate_id END,
    associate_name = CASE WHEN p_updates ? 'associate_name' THEN p_updates->>'associate_name' ELSE associate_name END,
    associate_effective_date = CASE WHEN p_updates ? 'associate_effective_date' THEN NULLIF(p_updates->>'associate_effective_date', '')::date ELSE associate_effective_date END,
    due_date = CASE WHEN p_updates ? 'due_date' THEN NULLIF(p_updates->>'due_date', '')::date ELSE due_date END,
    finish_by_date = CASE WHEN p_updates ? 'finish_by_date' THEN NULLIF(p_updates->>'finish_by_date', '')::date ELSE finish_by_date END,
    finish_by_time = CASE WHEN p_updates ? 'finish_by_time' THEN NULLIF(p_updates->>'finish_by_time', '')::time ELSE finish_by_time END,
    duration_days = COALESCE((p_updates->>'duration_days')::int, duration_days),
    duration_hours = COALESCE((p_updates->>'duration_hours')::int, duration_hours),
    status = COALESCE(p_updates->>'status', status),
    remarks = CASE WHEN p_updates ? 'remarks' THEN p_updates->>'remarks' ELSE remarks END,
    proposal_id = CASE WHEN p_updates ? 'proposal_id' THEN NULLIF(p_updates->>'proposal_id', '')::uuid ELSE proposal_id END,
    professional_fee = COALESCE((p_updates->>'professional_fee')::numeric, professional_fee),
    government_fee = COALESCE((p_updates->>'government_fee')::numeric, government_fee),
    gst_percentage = COALESCE((p_updates->>'gst_percentage')::numeric, gst_percentage),
    gst_amount = COALESCE((p_updates->>'gst_amount')::numeric, gst_amount),
    total_amount = COALESCE((p_updates->>'total_amount')::numeric, total_amount),
    pending_order = CASE WHEN p_updates ? 'pending_order' THEN (p_updates->>'pending_order')::int ELSE pending_order END
  WHERE id = p_work_id
  RETURNING status INTO v_new_status;

  SELECT to_jsonb(w.*) INTO v_updated_work FROM works w WHERE w.id = p_work_id;

  INSERT INTO work_tracking (
    work_id, type, by, uid, at, status
  ) VALUES (
    p_work_id, 'UPDATED', p_actor_name, p_actor_auth_user_id, NOW(), v_new_status
  );

  RETURN v_updated_work;
END;
$body LANGUAGE plpgsql SECURITY DEFINER;
