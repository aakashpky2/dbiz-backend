-- Migration: Separated Rules Engine
-- Date: 2026-06-12

-- 1. Add Condition Group to Applicability Conditions
ALTER TABLE government_fee_applicability_conditions
ADD COLUMN IF NOT EXISTS condition_group text DEFAULT 'AND';

-- 2. Create Calculation Rules Table
CREATE TABLE IF NOT EXISTS government_fee_calculation_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    government_fee_id uuid NOT NULL REFERENCES government_fee_library(id) ON DELETE CASCADE,
    calculation_type text NOT NULL DEFAULT 'fixed',
    
    fee_amount numeric DEFAULT 0,
    
    percentage_rate numeric DEFAULT 0,
    calculation_base_mapping_id uuid REFERENCES government_fee_source_mappings(id),
    minimum_fee numeric NULL,
    maximum_fee numeric NULL,
    
    slab_base_mapping_id uuid REFERENCES government_fee_source_mappings(id),
    
    due_date_mapping_id uuid REFERENCES government_fee_source_mappings(id),
    actual_date_mapping_id uuid REFERENCES government_fee_source_mappings(id),
    grace_period_days int DEFAULT 0,
    late_fee_method text NULL,
    fixed_amount numeric DEFAULT 0,
    per_day_amount numeric DEFAULT 0,
    maximum_late_fee numeric NULL,
    
    formula_expression text NULL,
    
    status text DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Create Rule Slabs
CREATE TABLE IF NOT EXISTS government_fee_rule_slabs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    calculation_rule_id uuid NOT NULL REFERENCES government_fee_calculation_rules(id) ON DELETE CASCADE,
    min_value numeric NULL,
    max_value numeric NULL,
    fee_type text NOT NULL DEFAULT 'fixed',
    amount numeric DEFAULT 0,
    percentage_rate numeric DEFAULT 0,
    minimum_fee numeric NULL,
    maximum_fee numeric NULL,
    display_order int DEFAULT 0
);

-- 4. Create Late Fee Slabs
CREATE TABLE IF NOT EXISTS government_fee_late_fee_slabs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    calculation_rule_id uuid NOT NULL REFERENCES government_fee_calculation_rules(id) ON DELETE CASCADE,
    min_days int NOT NULL,
    max_days int NULL,
    amount numeric DEFAULT 0,
    display_order int DEFAULT 0
);
