-- 20260519_create_notifications_table.sql
-- Migration SQL to create a robust central notification tracking table for D-Biz.

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
    recipient_role TEXT NULL,
    recipient_team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- e.g., 'TASK_CLAIMED', 'TASK_COMPLETED'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- 'work' or 'step_instance'
    entity_id UUID NULL,
    work_id UUID REFERENCES public.works(id) ON DELETE CASCADE,
    step_instance_id UUID REFERENCES public.workflow_step_instances(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance tuning indices
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_emp ON public.notifications(recipient_employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_team ON public.notifications(recipient_team_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
