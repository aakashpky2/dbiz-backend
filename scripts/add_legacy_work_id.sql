ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS legacy_work_id UUID;
CREATE INDEX IF NOT EXISTS idx_tasks_legacy_work_id ON public.tasks(legacy_work_id);
