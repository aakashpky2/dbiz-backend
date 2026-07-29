ALTER TABLE public.workflow_templates
ADD COLUMN IF NOT EXISTS common_information_fields jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS inheritance_mode text DEFAULT 'INHERIT',
ADD COLUMN IF NOT EXISTS cloned_from_workflow_id uuid NULL,
ADD COLUMN IF NOT EXISTS clone_label text NULL,
ADD COLUMN IF NOT EXISTS lineage_root_id uuid NULL;

ALTER TABLE public.workflow_templates
ADD CONSTRAINT workflow_templates_cloned_from_fk
FOREIGN KEY (cloned_from_workflow_id)
REFERENCES public.workflow_templates(id)
ON DELETE SET NULL;

ALTER TABLE public.workflow_templates
ADD CONSTRAINT workflow_templates_lineage_root_fk
FOREIGN KEY (lineage_root_id)
REFERENCES public.workflow_templates(id)
ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
