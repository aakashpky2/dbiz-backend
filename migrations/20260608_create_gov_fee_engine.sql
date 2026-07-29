-- Phase 1: Government Fee Master (Templates)
CREATE TABLE IF NOT EXISTS government_fee_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    work_type_id UUID,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Phase 2: Government Fee Components
CREATE TABLE IF NOT EXISTS government_fee_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES government_fee_templates(id) ON DELETE CASCADE,
    fee_name VARCHAR(255) NOT NULL,
    authority_name VARCHAR(255),
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_required BOOLEAN DEFAULT TRUE,
    is_editable BOOLEAN DEFAULT FALSE,
    calculation_method VARCHAR(50) NOT NULL, -- FIXED, PERCENTAGE, SLAB, MANUAL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Phase 3: Government Fee Rule Engine
CREATE TABLE IF NOT EXISTS government_fee_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id UUID NOT NULL REFERENCES government_fee_components(id) ON DELETE CASCADE,
    constitution_ids JSONB DEFAULT '[]',
    sub_constitution_ids JSONB DEFAULT '[]',
    state_ids JSONB DEFAULT '[]',
    client_type_ids JSONB DEFAULT '[]',
    min_authorized_capital NUMERIC,
    max_authorized_capital NUMERIC,
    min_paidup_capital NUMERIC,
    max_paidup_capital NUMERIC,
    min_turnover NUMERIC,
    max_turnover NUMERIC,
    min_contribution NUMERIC,
    max_contribution NUMERIC,
    fee_amount NUMERIC DEFAULT 0,
    percentage_rate NUMERIC,
    effective_from DATE,
    effective_to DATE,
    priority INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Phase 4: Work Type Parameters
CREATE TABLE IF NOT EXISTS work_type_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_type_id UUID NOT NULL,
    parameter_name VARCHAR(255) NOT NULL,
    parameter_code VARCHAR(100) NOT NULL,
    parameter_type VARCHAR(50) NOT NULL, -- text, number, currency, select, multi_select
    is_required BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
