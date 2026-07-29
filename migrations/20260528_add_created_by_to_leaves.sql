ALTER TABLE public.leaves
ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS idx_leaves_created_by
ON public.leaves (created_by);
