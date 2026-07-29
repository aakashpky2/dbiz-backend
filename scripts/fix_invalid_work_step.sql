-- Reset the confirmed invalid step instance
BEGIN;

SELECT id, status, document_values FROM workflow_step_instances WHERE id = '397d5ba6-69a1-40f6-8ada-c99ea28c0dc4';
SELECT id, status, progress_percentage FROM workflow_execution_instances WHERE id = '272442ca-a1ba-4040-bc3f-69a0ef2145be';

UPDATE workflow_step_instances
SET
    status = 'IN_PROGRESS',
    completed_by = NULL,
    actual_completed_at = NULL,
    updated_at = NOW()
WHERE id = '397d5ba6-69a1-40f6-8ada-c99ea28c0dc4'
  AND status = 'COMPLETED'
  AND (
      COALESCE((document_values->'aadhar'->>'uploaded')::boolean, false) = false
      OR COALESCE((document_values->'voter_id'->>'uploaded')::boolean, false) = false
  );

UPDATE workflow_execution_instances
SET
    progress_percentage = 0.00,
    status = 'IN_PROGRESS',
    actual_completed_at = NULL,
    updated_at = NOW()
WHERE id = '272442ca-a1ba-4040-bc3f-69a0ef2145be';

SELECT id, status, document_values FROM workflow_step_instances WHERE id = '397d5ba6-69a1-40f6-8ada-c99ea28c0dc4';
SELECT id, status, progress_percentage FROM workflow_execution_instances WHERE id = '272442ca-a1ba-4040-bc3f-69a0ef2145be';

COMMIT;
