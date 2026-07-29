-- Table 1: work_type_fee_fields
CREATE TABLE IF NOT EXISTS work_type_fee_fields (
    id uuid primary key default gen_random_uuid(),
    work_type_id uuid not null references work_types(id) on delete cascade,
    field_label text not null,
    field_key text not null,
    field_type text not null check (field_type in ('text','number','dropdown','date','boolean')),
    options jsonb default '[]'::jsonb,
    is_required boolean default false,
    display_order integer default 0,
    status text default 'active' check (status in ('active','inactive')),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    UNIQUE(work_type_id, field_key)
);

-- Table 2: government_fee_rules
ALTER TABLE government_fee_rules
    ADD COLUMN IF NOT EXISTS work_type_id uuid references work_types(id) on delete cascade,
    ADD COLUMN IF NOT EXISTS fee_name text,
    ADD COLUMN IF NOT EXISTS authority_name text,
    ADD COLUMN IF NOT EXISTS amount numeric(12,2) default 0,
    ADD COLUMN IF NOT EXISTS calculation_type text default 'fixed' check (calculation_type in ('fixed','percentage','formula')),
    ADD COLUMN IF NOT EXISTS formula text,
    ADD COLUMN IF NOT EXISTS condition_rules jsonb default '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS is_required boolean default true,
    ADD COLUMN IF NOT EXISTS is_editable boolean default true,
    ADD COLUMN IF NOT EXISTS notes text;

-- Note: government_fee_master is kept intact to avoid breaking existing references.
