ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS employee_id UUID,
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_password_reset TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_user_profiles_employee'
    ) THEN
        ALTER TABLE public.user_profiles
        ADD CONSTRAINT fk_user_profiles_employee
        FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_user_profiles_department'
    ) THEN
        ALTER TABLE public.user_profiles
        ADD CONSTRAINT fk_user_profiles_department
        FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
    END IF;
END $$;
