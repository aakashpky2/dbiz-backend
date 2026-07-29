ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS work_type_id uuid NULL,
ADD COLUMN IF NOT EXISTS workflow_template_id uuid NULL,
ADD COLUMN IF NOT EXISTS workflow_progress jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS claimed_by text NULL,
ADD COLUMN IF NOT EXISTS assigned_team_id uuid NULL,
ADD COLUMN IF NOT EXISTS started_at timestamp with time zone NULL,
ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone NULL,
ADD COLUMN IF NOT EXISTS reviewed_by text NULL,
ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone NULL,
ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS review_remarks text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_work_type_id_fk'
  ) THEN
    ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_work_type_id_fk
    FOREIGN KEY (work_type_id)
    REFERENCES public.work_types(id)
    ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_workflow_template_id_fk'
  ) THEN
    ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_workflow_template_id_fk
    FOREIGN KEY (workflow_template_id)
    REFERENCES public.workflow_templates(id)
    ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
