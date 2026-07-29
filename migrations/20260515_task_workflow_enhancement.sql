-- ==========================================
-- Task Workflow Enhancement Migration
-- ==========================================

ALTER TABLE works
ADD COLUMN IF NOT EXISTS current_handler_id UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'AVAILABLE';

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_works_workflow_status ON works(workflow_status);
CREATE INDEX IF NOT EXISTS idx_works_current_handler ON works(current_handler_id);

-- Update existing works to have a default workflow_status if needed
UPDATE works SET workflow_status = 'AVAILABLE' WHERE workflow_status IS NULL;
UPDATE works SET workflow_status = 'COMPLETED' WHERE status = 'Completed' AND workflow_status = 'AVAILABLE';
