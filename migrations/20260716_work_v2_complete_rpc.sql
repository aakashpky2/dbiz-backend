-- Migration: 20260716_work_v2_complete_rpc.sql

-- 1. Create the complete_workflow_step RPC
CREATE OR REPLACE FUNCTION complete_workflow_step(
    p_step_id UUID,
    p_employee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_step RECORD;
    v_exec RECORD;
    v_now TIMESTAMP WITH TIME ZONE := NOW();
    v_all_steps RECORD;
    v_unlocked_step_ids UUID[] := '{}';
    v_total_steps INT := 0;
    v_completed_count INT := 0;
    v_progress NUMERIC := 0;
    v_all_completed BOOLEAN := false;
BEGIN
    -- 1. Lock the step instance
    SELECT * INTO v_step
    FROM workflow_step_instances
    WHERE id = p_step_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Step instance not found: %', p_step_id;
    END IF;

    -- 2. Idempotency Check
    IF v_step.status = 'COMPLETED' THEN
        RETURN jsonb_build_object(
            'idempotent', true,
            'stepInstanceId', p_step_id
        );
    END IF;

    IF v_step.status IN ('LOCKED', 'BLOCKED') THEN
        RAISE EXCEPTION 'Cannot complete step % in status %', p_step_id, v_step.status;
    END IF;

    -- 3. Lock the execution instance
    SELECT * INTO v_exec
    FROM workflow_execution_instances
    WHERE id = v_step.execution_instance_id
    FOR UPDATE;

    IF v_exec.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot complete step % for execution % in status %', p_step_id, v_exec.id, v_exec.status;
    END IF;

    -- 4. Update the step instance
    UPDATE workflow_step_instances
    SET 
        status = 'COMPLETED',
        actual_completed_at = v_now,
        completed_by = p_employee_id,
        updated_at = v_now
    WHERE id = p_step_id;

    -- 5. Log step activity
    INSERT INTO workflow_step_activity_logs (
        step_instance_id,
        work_id,
        action,
        old_status,
        new_status,
        performed_by,
        created_at
    ) VALUES (
        p_step_id,
        v_exec.work_id,
        'COMPLETED',
        v_step.status,
        'COMPLETED',
        p_employee_id,
        v_now
    );

    -- 6. DAG Dependency Unlocking
    -- Check sibling steps that depend on this one
    FOR v_all_steps IN
        SELECT * FROM workflow_step_instances
        WHERE execution_instance_id = v_exec.id
        AND status IN ('LOCKED', 'BLOCKED')
        FOR UPDATE
    LOOP
        -- If p_step_id is in its depends_on_step_instance_ids array
        IF p_step_id = ANY(v_all_steps.depends_on_step_instance_ids) THEN
            -- Check if all parents are now COMPLETED or SKIPPED
            IF (
                SELECT bool_and(status IN ('COMPLETED', 'SKIPPED'))
                FROM workflow_step_instances
                WHERE id = ANY(v_all_steps.depends_on_step_instance_ids)
                -- Treat the current step as completed in this subquery, since we just updated it
                -- (the subquery will see the updated row because they are in the same transaction)
            ) THEN
                -- Unlock it
                UPDATE workflow_step_instances
                SET status = 'AVAILABLE',
                    updated_at = v_now
                WHERE id = v_all_steps.id;
                
                v_unlocked_step_ids := array_append(v_unlocked_step_ids, v_all_steps.id);

                INSERT INTO workflow_step_activity_logs (
                    step_instance_id,
                    work_id,
                    action,
                    old_status,
                    new_status,
                    performed_by,
                    remarks,
                    created_at
                ) VALUES (
                    v_all_steps.id,
                    v_exec.work_id,
                    'STATUS_CHANGE',
                    v_all_steps.status,
                    'AVAILABLE',
                    p_employee_id,
                    'Unlocked topologically via parent completions',
                    v_now
                );
            END IF;
        END IF;
    END LOOP;

    -- 7. Calculate Progress
    SELECT 
        COUNT(*) FILTER (WHERE status != 'SKIPPED'), -- Denominator
        COUNT(*) FILTER (WHERE status = 'COMPLETED') -- Numerator
    INTO v_total_steps, v_completed_count
    FROM workflow_step_instances
    WHERE execution_instance_id = v_exec.id;

    IF v_total_steps > 0 THEN
        v_progress := ROUND((v_completed_count::NUMERIC / v_total_steps::NUMERIC) * 100, 2);
    ELSE
        v_progress := 100;
    END IF;

    v_all_completed := (v_progress = 100);

    -- 8. Update Execution (Do NOT autocomplete Work)
    UPDATE workflow_execution_instances
    SET
        progress_percentage = v_progress,
        updated_at = v_now
    WHERE id = v_exec.id;

    RETURN jsonb_build_object(
        'idempotent', false,
        'stepInstanceId', p_step_id,
        'progressPercentage', v_progress,
        'allStepsComplete', v_all_completed,
        'unlockedStepIds', v_unlocked_step_ids
    );

END;
$$;
