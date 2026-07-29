-- Migration: Independent Government Fee Library
-- Date: 2026-06-10

-- Table: government_fee_library
CREATE TABLE IF NOT EXISTS government_fee_library (
    id uuid primary key default gen_random_uuid(),
    fee_name text not null,
    fee_category text,
    authority_name text,
    amount numeric(12,2) default 0,
    calculation_type text default 'fixed',
    formula text,
    effective_from date default current_date,
    effective_to date,
    status text default 'active',
    notes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Table: government_fee_applicability_conditions
CREATE TABLE IF NOT EXISTS government_fee_applicability_conditions (
    id uuid primary key default gen_random_uuid(),
    government_fee_id uuid not null references government_fee_library(id) on delete cascade,
    condition_label text not null,
    source_type text default 'database_column',
    source_table text not null,
    source_column text not null,
    source_json_path text,
    operator text not null,
    compare_value jsonb,
    min_value numeric,
    max_value numeric,
    min_date date,
    max_date date,
    is_required boolean default true,
    status text default 'active',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_government_fee_library_modtime()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_government_fee_library_modtime
    BEFORE UPDATE ON government_fee_library
    FOR EACH ROW
    EXECUTE PROCEDURE update_government_fee_library_modtime();

CREATE OR REPLACE FUNCTION update_government_fee_applicability_conditions_modtime()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_government_fee_applicability_conditions_modtime
    BEFORE UPDATE ON government_fee_applicability_conditions
    FOR EACH ROW
    EXECUTE PROCEDURE update_government_fee_applicability_conditions_modtime();
