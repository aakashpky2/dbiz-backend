-- Create user_active_work table for Global Active Work Tracker
CREATE TABLE IF NOT EXISTS user_active_work (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Additional contextual info
    work_type_id UUID REFERENCES worktype_master(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'paused', 'completed')),
    
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    paused_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    progress INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT active_work_must_have_reference CHECK (work_id IS NOT NULL OR task_id IS NOT NULL)
);

-- Index for quick lookups for the current user's active work
CREATE INDEX IF NOT EXISTS idx_user_active_work_employee_id ON user_active_work(employee_id);
CREATE INDEX IF NOT EXISTS idx_user_active_work_status ON user_active_work(status);

-- We don't enforce one-active-work-per-user strictly in the DB constraint (or we could use a partial unique index, but application layer might handle it better with 'switch' logic where old is paused).
-- But let's create a partial unique index to enforce only one 'in_progress' work per employee at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_work_per_employee 
ON user_active_work (employee_id) 
WHERE status = 'in_progress';

-- Enable Row Level Security
ALTER TABLE user_active_work ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own active work"
ON user_active_work FOR SELECT
USING (auth.uid() = employee_id);

CREATE POLICY "Users can insert their own active work"
ON user_active_work FOR INSERT
WITH CHECK (auth.uid() = employee_id);

CREATE POLICY "Users can update their own active work"
ON user_active_work FOR UPDATE
USING (auth.uid() = employee_id);

-- Optional: Admin policy
CREATE POLICY "Admins can view all active works"
ON user_active_work FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
));
