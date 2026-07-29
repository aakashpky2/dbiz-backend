-- Create the unified government_fee_master table
CREATE TABLE IF NOT EXISTS government_fee_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_type_id UUID NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
    constitution_id UUID NULL,
    sub_constitution_id UUID NULL,
    state TEXT NULL,
    client_type TEXT NULL,
    fee_name TEXT NOT NULL,
    authority_name TEXT NULL,
    amount NUMERIC DEFAULT 0,
    calculation_type TEXT DEFAULT 'FIXED',
    is_required BOOLEAN DEFAULT true,
    is_editable BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'active',
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_government_fee_master_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_government_fee_master_updated_at ON government_fee_master;
CREATE TRIGGER trg_government_fee_master_updated_at
BEFORE UPDATE ON government_fee_master
FOR EACH ROW
EXECUTE FUNCTION update_government_fee_master_updated_at();

-- Add Indexes for common matching queries
CREATE INDEX IF NOT EXISTS idx_gov_fee_master_work_type ON government_fee_master(work_type_id);
CREATE INDEX IF NOT EXISTS idx_gov_fee_master_constitution ON government_fee_master(constitution_id);
CREATE INDEX IF NOT EXISTS idx_gov_fee_master_sub_constitution ON government_fee_master(sub_constitution_id);
CREATE INDEX IF NOT EXISTS idx_gov_fee_master_state ON government_fee_master(state);
CREATE INDEX IF NOT EXISTS idx_gov_fee_master_client_type ON government_fee_master(client_type);
